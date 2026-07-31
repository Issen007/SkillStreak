import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ChatMessageAlreadyReportedException,
  ChatMessageNotFoundException,
  ChatMessageRejectedByFilterException,
  ChatReportRateLimitedException,
  ChatSendRateLimitedException,
  ClipNotFoundException,
  ConsentRequiredException,
  TeamJoinApprovalRequiredException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { buildChatReportNotificationEmail } from '../mail/templates/chat-report-notification-email.template';
import { MailService } from '../mail/mail.service';
import { Player } from '../players/entities/player.entity';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { PlayersService } from '../players/players.service';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { Coach } from '../coaches/entities/coach.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsService } from '../teams/teams.service';
import { RedisService } from '../redis/redis.service';
import { ObjectStorageService } from '../video-clips/object-storage.service';
import { CLIP_PLAYBACK_URL_EXPIRES_SECONDS } from '../video-clips/video-clip.constants';
import {
  VideoClip,
  VideoClipStatus,
} from '../video-clips/entities/video-clip.entity';
import type { ChatModerationCheck } from './chat-moderation-check.interface';
import { CHAT_MODERATION_CHECK } from './chat-moderation-check.interface';
import { BlockChatPlayerDto } from './dto/block-chat-player.dto';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { DEFAULT_CHAT_MESSAGE_LIMIT } from './dto/list-chat-messages-query.dto';
import { ReportChatMessageDto } from './dto/report-chat-message.dto';
import { TeamChatBlock } from './entities/team-chat-block.entity';
import {
  ChatMessageStatus,
  TeamChatMessage,
} from './entities/team-chat-message.entity';
import {
  ChatMessageReportReason,
  TeamChatMessageReport,
} from './entities/team-chat-message-report.entity';

const REPORT_UNIQUE_CONSTRAINT = 'UQ_team_chat_message_report_message_reporter';
const BLOCK_UNIQUE_CONSTRAINT = 'UQ_team_chat_block_blocker_blocked';

const REASON_LABELS_SV: Record<ChatMessageReportReason, string> = {
  [ChatMessageReportReason.BULLYING]: 'mobbning',
  [ChatMessageReportReason.INAPPROPRIATE_LANGUAGE]: 'olämpligt språk',
  [ChatMessageReportReason.SPAM]: 'spam',
  [ChatMessageReportReason.OTHER]: 'övrigt',
};

function assertConsentApproved(status: ParentalConsentStatus): void {
  if (status !== ParentalConsentStatus.APPROVED) {
    throw new ConsentRequiredException();
  }
}

// Added 2026-07-27 — a second, independent gate alongside
// assertConsentApproved above (see TeamJoinApprovalRequiredException).
function assertTeamJoinApproved(status: TeamJoinStatus): void {
  if (status !== TeamJoinStatus.APPROVED) {
    throw new TeamJoinApprovalRequiredException();
  }
}

// docs/adr/0017-chat-clip-attachments.md Decision 5 — the nullable `clip`
// block on both the send response and the list response. Nothing here is
// ever a snapshot: every field is resolved live, per request, from the
// clip's *current* row (Decision 2) — this interface shape is what that
// live resolution produces, not what's stored anywhere.
export interface ChatClipEmbed {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
}

export interface ChatMessageResponse {
  id: string;
  teamId: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
  // Always populated when a clipId was sent and accepted (it was just
  // validated as `published` one query earlier in the same request); null
  // only when no clipId was sent (ADR-0017 Decision 5). The `null`-on-
  // unavailable case only ever arises later, on GET.
  clip: ChatClipEmbed | null;
  createdAt: string;
}

export interface ChatMessageListItem {
  id: string;
  // Nullable since docs/adr/0013-account-erasure.md Decision 6: an erased
  // player's messages are anonymized in place (sender_player_id set null,
  // content overwritten with a fixed placeholder), never hard-deleted, to
  // preserve the flat feed's continuity. All three sender fields are null
  // together, never independently.
  senderPlayerId: string | null;
  senderScreenName: string | null;
  senderAvatarId: string | null;
  content: string;
  // Null whenever: the message never had a clipId; the referenced clip is
  // gone (self-deleted/expired); the referenced clip is hidden; or the
  // viewer has blocked the clip's uploader (ADR-0017 Decision 2). The
  // client cannot and should not try to distinguish these — one
  // placeholder, always.
  clip: ChatClipEmbed | null;
  createdAt: string;
  reportedByMe: boolean;
}

// Raw columns selected alongside the hydrated TeamChatMessage entity by
// listMessages's LEFT JOIN (ADR-0017 Decision 1/2) — see
// resolveClipEmbedFromRawRow. All null together whenever the join predicate
// excluded the row (no clipId, wrong team, not published, or the viewer has
// blocked the uploader).
interface ChatMessageClipRawRow {
  clipId: string | null;
  clipUploaderPlayerId: string | null;
  clipStorageKey: string | null;
  clipCaption: string | null;
  clipCreatedAt: Date | string | null;
}

export interface ChatReportResponse {
  reportId: string;
  messageId: string;
  createdAt: string;
}

export interface ChatBlockResponse {
  blockedPlayerId: string;
  createdAt: string;
}

export interface ChatUnblockResponse {
  blockedPlayerId: string;
  unblocked: true;
}

// Team-scoped, real-time-ish freeform chat between players — the highest
// child-safety-risk feature in this app so far (docs/adr/0007-team-chat.md).
// Every method starts with a team-membership check
// (PlayersService.assertTeamMembership), same pattern as every other
// Phase 2 team-scoped service — no captain gate anywhere here (ADR-0007
// Decision 5: one shared channel, the captain is a participant, not a
// moderator of it).
@Injectable()
export class TeamChatService {
  private readonly logger = new Logger(TeamChatService.name);

  constructor(
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly teamsService: TeamsService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    // docs/adr/0017-chat-clip-attachments.md — team-chat/'s first
    // dependency on video-clips/, one-directional and read-only, scoped to
    // exactly the loaded-row (postMessage) / join-predicate (listMessages)
    // checks Decision 1 describes, plus reusing the same presigned-GET
    // mechanism the clip feed already uses (Decision 5's "reuse whatever
    // presigning mechanism the feed endpoint already uses").
    private readonly objectStorageService: ObjectStorageService,
    @Inject(CHAT_MODERATION_CHECK)
    private readonly chatModerationCheck: ChatModerationCheck,
    @InjectRepository(TeamChatMessage)
    private readonly messageRepository: Repository<TeamChatMessage>,
    @InjectRepository(TeamChatBlock)
    private readonly blockRepository: Repository<TeamChatBlock>,
    @InjectRepository(TeamChatMessageReport)
    private readonly reportRepository: Repository<TeamChatMessageReport>,
    @InjectRepository(TeamCoach)
    private readonly teamCoachRepository: Repository<TeamCoach>,
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>,
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
  ) {}

  /**
   * docs/api/phase2.6b-contract.md endpoint 1 / docs/adr/0017-chat-clip-
   * attachments.md Decision 5. Order: team membership -> consent gate (same
   * check/error as POST /training-logs, per ADR-0007's extension of
   * ADR-0002 addendum §2) -> team-join-approval gate -> **new**: if
   * `clipId` is present, resolve + validate it (ADR-0017 Decision 1 —
   * loaded-row team+published check, 404 clip_not_found either way, merged
   * so this can't be used as a cross-team existence oracle) -> **new**: the
   * combined "content or clipId, not neither" 400 (ADR-0017 Decision 4) ->
   * the send-rate-limit allowance -> the moderation check -> persist. The
   * new clip checks run *before* the rate-limit claim and the moderation
   * check, matching the ADR's explicit "clip resolution before an invalid
   * reference could spend a moderation check on text that would be
   * discarded anyway." The *existing* rate-limit-claimed-before-moderation
   * relationship itself is untouched (ADR-0017 says both are "unchanged") —
   * that ordering is a deliberate ADR-0007 anti-abuse property (see below),
   * not something this ADR revisits.
   *
   * The rate limit is claimed *before* the moderation check runs (a
   * deliberate choice, not specified by either contract): otherwise an
   * attacker could send unlimited filter-probing junk with zero cost as
   * long as every attempt gets rejected, using this endpoint to
   * reverse-engineer the wordlist for free. Charging the allowance for
   * every *attempt* (accepted or filtered) is the more conservative,
   * abuse-resistant order.
   */
  async postMessage(
    teamId: string,
    requesterId: string,
    dto: CreateChatMessageDto,
  ): Promise<ChatMessageResponse> {
    const player = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    assertConsentApproved(player.parentalConsentStatus);
    assertTeamJoinApproved(player.teamJoinStatus);

    let clip: VideoClip | null = null;
    if (dto.clipId) {
      clip = await this.videoClipRepository.findOne({
        where: {
          id: dto.clipId,
          teamId,
          status: VideoClipStatus.PUBLISHED,
        },
      });
      if (!clip) {
        // Deliberately the same generic 404 as
        // docs/api/phase3-contract.md's own clip_not_found — merges "no
        // such clip," "wrong team," and "not published yet" into one
        // response (ADR-0017 Decision 1).
        throw new ClipNotFoundException();
      }
    }

    // ADR-0017 Decision 4 — "a message must contain at least one of
    // non-empty content or a clipId; both absent/empty is 400." dto.content
    // is already trimmed by the DTO's own @Transform, so an empty string
    // here means "empty or whitespace-only as submitted."
    if (!dto.content && !clip) {
      throw new BadRequestException(
        'content must be non-empty unless clipId is present.',
      );
    }

    const claimed =
      await this.redisService.tryClaimChatSendAllowance(requesterId);
    if (!claimed) {
      throw new ChatSendRateLimitedException();
    }

    const moderation = await this.chatModerationCheck.check(dto.content);
    if (!moderation.allowed) {
      // Never partially stored/redacted — the message either sends as
      // written or doesn't send at all (ADR-0007 Decision 2). Never
      // re-checks a clip's own caption — that was already moderation-
      // checked at upload time (ADR-0017 Decision 5).
      throw new ChatMessageRejectedByFilterException();
    }

    const message = await this.messageRepository.save(
      this.messageRepository.create({
        teamId,
        senderPlayerId: requesterId,
        content: dto.content,
        clipId: clip?.id ?? null,
        status: ChatMessageStatus.VISIBLE,
      }),
    );

    return {
      id: message.id,
      teamId,
      senderPlayerId: requesterId,
      senderScreenName: player.screenName,
      senderAvatarId: player.avatarId,
      content: message.content,
      clip: clip ? await this.buildClipEmbed(clip) : null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /**
   * docs/api/phase2.6b-contract.md endpoint 2 / docs/adr/0017-chat-clip-
   * attachments.md Decisions 1-2. The status filter (`!= 'hidden'`) and the
   * per-viewer block filter on the *message's own sender* (`NOT EXISTS`
   * against TeamChatBlock scoped to the requester) are applied in this
   * single query — the one thing ADR-0007 Decision 5 / the contract's
   * implementer note is explicit must not be two layered post-processing
   * passes, since that's the one place a future refactor could silently
   * drop a filter and leak a blocked/hidden message.
   *
   * The clip embed is resolved via a `LEFT JOIN` whose predicate itself
   * encodes every visibility rule for the attachment — `clip.team_id =
   * message.team_id`, `clip.status = 'published'`, and a second, *clip-
   * uploader-scoped* `NOT EXISTS` against TeamChatBlock (extending the same
   * per-viewer block precedent to the embed, ADR-0017 Decision 2) — all in
   * the same query as the join itself, not a bare id join followed by an
   * app-level filter (ADR-0017 Decision 1's "structural, not a code-review
   * reminder" bar). A row's clip columns come back entirely null whenever
   * any one of those conditions fails, and `resolveClipEmbedFromRawRow`
   * below collapses every such case to the identical `clip: null` — the
   * client cannot and should not distinguish "no clipId," "clip deleted/
   * expired," "clip hidden," or "uploader blocked" (Decision 2).
   *
   * Sender enrichment (screenName/avatarId), `reportedByMe`, and the clip
   * embed's own uploader lookup/presigned URL are deliberately separate
   * follow-up steps — the contract's "one query" requirement is
   * specifically about *visibility* (which rows/attachments are even
   * allowed to be seen), not about every field in the response.
   */
  async listMessages(
    teamId: string,
    requesterId: string,
    after: string | undefined,
    limit: number = DEFAULT_CHAT_MESSAGE_LIMIT,
  ): Promise<ChatMessageListItem[]> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    const qb = this.messageRepository
      .createQueryBuilder('message')
      .leftJoin(
        VideoClip,
        'clip',
        `clip.id = message.clip_id
           AND clip.team_id = message.team_id
           AND clip.status = :clipStatus
           AND NOT EXISTS (
             SELECT 1 FROM team_chat_block clip_block
             WHERE clip_block.blocker_player_id = :requesterId
               AND clip_block.blocked_player_id = clip.uploader_player_id
           )`,
        { clipStatus: VideoClipStatus.PUBLISHED, requesterId },
      )
      .addSelect('clip.id', 'clipId')
      .addSelect('clip.uploader_player_id', 'clipUploaderPlayerId')
      .addSelect('clip.storage_key', 'clipStorageKey')
      .addSelect('clip.caption', 'clipCaption')
      .addSelect('clip.created_at', 'clipCreatedAt')
      .where('message.team_id = :teamId', { teamId })
      .andWhere('message.status = :status', {
        status: ChatMessageStatus.VISIBLE,
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM team_chat_block block
          WHERE block.blocker_player_id = :requesterId
            AND block.blocked_player_id = message.sender_player_id
        )`,
        { requesterId },
      );

    if (after) {
      qb.andWhere('message.created_at > :after', { after: new Date(after) });
    }

    qb.orderBy('message.created_at', 'ASC').limit(limit);

    const { entities: messages, raw } = await qb.getRawAndEntities();
    if (messages.length === 0) {
      return [];
    }

    // Sender/uploader enrichment: listByTeam is a full-team read, fine at
    // this project's repeatedly-stated "a handful of players" scale (same
    // reasoning WeeklyGoalService's roster/dashboard already rely on) — a
    // clip's uploader is always a current team member too (same guarantee
    // VideoClipsService.listClips already relies on), so this one roster
    // read covers both.
    const players = await this.playersService.listByTeam(teamId);
    const playerById = new Map(players.map((p) => [p.id, p]));

    const messageIds = messages.map((m) => m.id);
    const myReports = await this.reportRepository.find({
      where: { messageId: In(messageIds), reporterPlayerId: requesterId },
    });
    const reportedMessageIds = new Set(myReports.map((r) => r.messageId));

    return Promise.all(
      messages.map(async (message, index) => {
        const clip = await this.resolveClipEmbedFromRawRow(
          raw[index] as ChatMessageClipRawRow,
          teamId,
          playerById,
        );

        // docs/adr/0013-account-erasure.md Decision 6 — a message whose
        // sender has since erased their account has sender_player_id = null
        // (set in the same transaction that deletes their Player row), by
        // construction never a *dangling* reference to a since-deleted
        // player id. Rendered as an anonymized entry, not an error.
        if (message.senderPlayerId === null) {
          return {
            id: message.id,
            senderPlayerId: null,
            senderScreenName: null,
            senderAvatarId: null,
            content: message.content,
            clip,
            createdAt: message.createdAt.toISOString(),
            reportedByMe: reportedMessageIds.has(message.id),
          };
        }

        const sender = playerById.get(message.senderPlayerId);
        if (!sender) {
          // Can't occur given the API contract: a message's sender is
          // either null (anonymized, handled above) or whoever posted it,
          // which postMessage only ever allows for a current team member,
          // and a player row is never deleted without first nulling every
          // message it sent (AccountErasureService). Surfaced as a 500, not
          // defended against as normal client input.
          throw new Error(
            `TeamChatMessage ${message.id} references sender ${message.senderPlayerId} not found on team ${teamId}`,
          );
        }
        return {
          id: message.id,
          senderPlayerId: message.senderPlayerId,
          senderScreenName: sender.screenName,
          senderAvatarId: sender.avatarId,
          content: message.content,
          clip,
          createdAt: message.createdAt.toISOString(),
          reportedByMe: reportedMessageIds.has(message.id),
        };
      }),
    );
  }

  /**
   * docs/adr/0017-chat-clip-attachments.md Decision 5 — builds the `clip`
   * embed for `POST .../chat/messages`'s response, from an already-loaded,
   * already-validated `VideoClip` row (postMessage just confirmed
   * `teamId`/`published` one query earlier in the same request, so no
   * re-check is needed here). Reuses `ObjectStorageService`'s presigned-GET
   * mechanism, identical to the clip feed's own (never cached/reused across
   * requests, per ADR-0010 Decision 2).
   */
  private async buildClipEmbed(clip: VideoClip): Promise<ChatClipEmbed> {
    const uploader = await this.playersService.findByIdOrThrow(
      clip.uploaderPlayerId,
    );
    const playbackUrl = await this.objectStorageService.createPresignedGetUrl(
      clip.storageKey,
      CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
    );
    return {
      clipId: clip.id,
      uploaderPlayerId: clip.uploaderPlayerId,
      uploaderScreenName: uploader.screenName,
      uploaderAvatarId: uploader.avatarId,
      caption: clip.caption,
      playbackUrl,
      createdAt: clip.createdAt.toISOString(),
    };
  }

  /**
   * docs/adr/0017-chat-clip-attachments.md Decision 2 — collapses
   * `listMessages`'s joined raw clip columns into the response's `clip`
   * field. `row.clipId` is null whenever the join predicate excluded the
   * row for *any* reason (no clipId on the message, wrong team, not
   * published, or the viewer has blocked the clip's uploader) — this method
   * doesn't and can't distinguish which, by construction, matching the
   * contract's "one placeholder, always."
   */
  private async resolveClipEmbedFromRawRow(
    row: ChatMessageClipRawRow,
    teamId: string,
    playerById: Map<string, Player>,
  ): Promise<ChatClipEmbed | null> {
    if (!row.clipId) {
      return null;
    }
    const uploader = playerById.get(row.clipUploaderPlayerId as string);
    if (!uploader) {
      // Can't occur given the API contract: the join predicate already
      // confirmed this clip belongs to `teamId`, and every clip's uploader
      // is a current member of the team it was uploaded to (same guarantee
      // VideoClipsService.listClips already relies on for its own identical
      // guard). Surfaced as a 500, not defended against as normal input.
      throw new Error(
        `VideoClip ${row.clipId} references uploader ${row.clipUploaderPlayerId} not found on team ${teamId}`,
      );
    }
    const playbackUrl = await this.objectStorageService.createPresignedGetUrl(
      row.clipStorageKey as string,
      CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
    );
    return {
      clipId: row.clipId,
      uploaderPlayerId: uploader.id,
      uploaderScreenName: uploader.screenName,
      uploaderAvatarId: uploader.avatarId,
      caption: row.clipCaption,
      playbackUrl,
      createdAt: new Date(row.clipCreatedAt as string).toISOString(),
    };
  }

  /**
   * docs/api/phase2.6b-contract.md endpoint 3 (ADR-0007 Decision 3 — read
   * that section before touching this method, not just this comment).
   * Order: team membership -> message exists on this team (404) ->
   * already-reported-by-this-viewer pre-check (409, checked *before*
   * claiming the report-cooldown, so an already-answered duplicate doesn't
   * burn the reporter's rate limit — same "claim the cooldown only after
   * the checks that would make this call fail anyway" posture
   * ConsentService.sendReminder already uses) -> the report cooldown (429)
   * -> insert (with the unique-violation catch kept as a race backstop) ->
   * best-effort, rate-limited notification email. Reporting never touches
   * `status` — hiding is exclusively an out-of-band admin action.
   */
  async reportMessage(
    teamId: string,
    requesterId: string,
    messageId: string,
    dto: ReportChatMessageDto,
  ): Promise<ChatReportResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    const message = await this.messageRepository.findOne({
      where: { id: messageId, teamId },
    });
    if (!message) {
      throw new ChatMessageNotFoundException();
    }

    const existingReport = await this.reportRepository.findOne({
      where: { messageId, reporterPlayerId: requesterId },
    });
    if (existingReport) {
      throw new ChatMessageAlreadyReportedException();
    }

    const claimed =
      await this.redisService.tryClaimChatReportCooldown(requesterId);
    if (!claimed) {
      throw new ChatReportRateLimitedException();
    }

    let report: TeamChatMessageReport;
    try {
      report = await this.reportRepository.save(
        this.reportRepository.create({
          messageId,
          reporterPlayerId: requesterId,
          reason: dto.reason,
          note: dto.note ?? null,
        }),
      );
    } catch (error) {
      if (isPostgresUniqueViolation(error, REPORT_UNIQUE_CONSTRAINT)) {
        // Backstop for a race between the pre-check above and this insert
        // (two near-simultaneous reports of the same message by the same
        // player) — should be rare, kept for the same reason every other
        // unique-violation in this codebase is caught rather than left to
        // surface as a raw 500.
        throw new ChatMessageAlreadyReportedException();
      }
      throw error;
    }

    // A report against an already-anonymized message (its sender erased
    // their own account since the message was sent) has nobody left to
    // notify — docs/adr/0013-account-erasure.md Decision 6 keeps the
    // report row itself intact regardless (a moderation record, not "their
    // content"), it just has no live target for this notification anymore.
    if (message.senderPlayerId !== null) {
      await this.sendReportNotificationBestEffort(
        teamId,
        message.senderPlayerId,
        dto.reason,
        message.content,
      );
    }

    return {
      reportId: report.id,
      messageId,
      createdAt: report.createdAt.toISOString(),
    };
  }

  /**
   * docs/api/phase2.6b-contract.md endpoint 4. Idempotent — blocking an
   * already-blocked player is a 200 no-op, not an error (ADR-0007 Decision
   * 4), so this is a find-then-create with a unique-violation catch as a
   * race backstop (two near-simultaneous identical block requests), not a
   * hard failure either way.
   */
  async blockPlayer(
    teamId: string,
    requesterId: string,
    dto: BlockChatPlayerDto,
  ): Promise<ChatBlockResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    if (dto.blockedPlayerId === requesterId) {
      throw new BadRequestException(
        "blockedPlayerId cannot equal the requesting player's own id.",
      );
    }

    const target = await this.playersService.findByIdOrThrow(
      dto.blockedPlayerId,
    );
    if (target.teamId !== teamId) {
      throw new TeamMismatchException();
    }

    const existing = await this.blockRepository.findOne({
      where: {
        blockerPlayerId: requesterId,
        blockedPlayerId: dto.blockedPlayerId,
      },
    });
    if (existing) {
      return {
        blockedPlayerId: dto.blockedPlayerId,
        createdAt: existing.createdAt.toISOString(),
      };
    }

    try {
      const saved = await this.blockRepository.save(
        this.blockRepository.create({
          blockerPlayerId: requesterId,
          blockedPlayerId: dto.blockedPlayerId,
        }),
      );
      return {
        blockedPlayerId: dto.blockedPlayerId,
        createdAt: saved.createdAt.toISOString(),
      };
    } catch (error) {
      if (isPostgresUniqueViolation(error, BLOCK_UNIQUE_CONSTRAINT)) {
        const raced = await this.blockRepository.findOneOrFail({
          where: {
            blockerPlayerId: requesterId,
            blockedPlayerId: dto.blockedPlayerId,
          },
        });
        return {
          blockedPlayerId: dto.blockedPlayerId,
          createdAt: raced.createdAt.toISOString(),
        };
      }
      throw error;
    }
  }

  /** docs/api/phase2.6b-contract.md endpoint 5 — idempotent unblock,
   * succeeds whether or not a block existed. */
  async unblockPlayer(
    teamId: string,
    requesterId: string,
    blockedPlayerId: string,
  ): Promise<ChatUnblockResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);
    await this.blockRepository.delete({
      blockerPlayerId: requesterId,
      blockedPlayerId,
    });
    return { blockedPlayerId, unblocked: true };
  }

  /**
   * ADR-0007 Decision 3's two-destination best-effort email, reusing the
   * MailService/"best-effort mail send" pattern documented in
   * backend/README.md (ConsentService.sendReminderEmailBestEffort): never
   * throws, only logs on failure, and the report row above has already
   * been persisted independently of whether this succeeds. Rate-limited to
   * at most one email per reported player per rolling 24 hours — claimed
   * as part of this same best-effort block, so a cooldown-window miss
   * degrades to "no email sent" rather than a failed request.
   */
  private async sendReportNotificationBestEffort(
    teamId: string,
    reportedPlayerId: string,
    reason: ChatMessageReportReason,
    messageContent: string,
  ): Promise<void> {
    try {
      const recipients: string[] = [];
      const parentContact =
        await this.playerPrivateInfoService.getParentContact(reportedPlayerId);
      if (parentContact) {
        recipients.push(parentContact);
      }
      recipients.push(...(await this.getTeamCoachEmails(teamId)));

      if (recipients.length === 0) {
        this.logger.warn(
          `No parent/coach contact on file for chat report on player ${reportedPlayerId} — no email sent.`,
        );
        return;
      }

      // Claimed only once we know there's actually an email to send — a
      // report against a player with no contact on file must not burn this
      // player's 24h window for a *future* report that might have a real
      // recipient (security-reviewer finding, Phase 2.6b pass: the cooldown
      // key should track "an email was sent," not "a report was processed").
      const claimed =
        await this.redisService.tryClaimChatReportNotifyCooldown(
          reportedPlayerId,
        );
      if (!claimed) {
        this.logger.log(
          `Chat-report notification for player ${reportedPlayerId} suppressed by the 24h cooldown.`,
        );
        return;
      }

      const reportedPlayer =
        await this.playersService.findByIdOrThrow(reportedPlayerId);
      const team = await this.teamsService.findById(teamId);
      const email = buildChatReportNotificationEmail({
        reportedScreenName: reportedPlayer.screenName,
        teamName: team?.name ?? '',
        reasonLabel: REASON_LABELS_SV[reason],
        messageContent,
      });

      for (const to of recipients) {
        await this.mailService.sendMail({
          to,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send chat-report notification for player ${reportedPlayerId}: ${message}`,
      );
    }
  }

  /**
   * ADR-0007 Decision 3's "team's coach, if one is on file" — reuses only
   * the dormant TeamCoach/Coach schema's stored email address (ADR-0004's
   * addendum), nothing about coach login/auth is reactivated. A team may
   * have zero or more than one coach on file; every one of them gets the
   * notification (no "just the first" narrowing).
   */
  private async getTeamCoachEmails(teamId: string): Promise<string[]> {
    const links = await this.teamCoachRepository.find({ where: { teamId } });
    if (links.length === 0) {
      return [];
    }
    const coachIds = [...new Set(links.map((link) => link.coachId))];
    const coaches = await this.coachRepository.find({
      where: { id: In(coachIds) },
    });
    return coaches.map((coach) => coach.email);
  }
}
