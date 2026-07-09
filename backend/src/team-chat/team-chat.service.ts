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
  ConsentRequiredException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import { buildChatReportNotificationEmail } from '../mail/templates/chat-report-notification-email.template';
import { MailService } from '../mail/mail.service';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { Coach } from '../coaches/entities/coach.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsService } from '../teams/teams.service';
import { RedisService } from '../redis/redis.service';
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

export interface ChatMessageResponse {
  id: string;
  teamId: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
  createdAt: string;
}

export interface ChatMessageListItem {
  id: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
  createdAt: string;
  reportedByMe: boolean;
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
  ) {}

  /**
   * docs/api/phase2.6b-contract.md endpoint 1. Order: team membership ->
   * consent gate (same check/error as POST /training-logs, per ADR-0007's
   * extension of ADR-0002 addendum §2) -> the send-rate-limit allowance ->
   * the moderation check -> persist. The rate limit is claimed *before* the
   * moderation check runs (a deliberate choice, not specified by the
   * contract): otherwise an attacker could send unlimited filter-probing
   * junk with zero cost as long as every attempt gets rejected, using this
   * endpoint to reverse-engineer the wordlist for free. Charging the
   * allowance for every *attempt* (accepted or filtered) is the more
   * conservative, abuse-resistant order.
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

    const claimed =
      await this.redisService.tryClaimChatSendAllowance(requesterId);
    if (!claimed) {
      throw new ChatSendRateLimitedException();
    }

    const moderation = await this.chatModerationCheck.check(dto.content);
    if (!moderation.allowed) {
      // Never partially stored/redacted — the message either sends as
      // written or doesn't send at all (ADR-0007 Decision 2).
      throw new ChatMessageRejectedByFilterException();
    }

    const message = await this.messageRepository.save(
      this.messageRepository.create({
        teamId,
        senderPlayerId: requesterId,
        content: dto.content,
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
      createdAt: message.createdAt.toISOString(),
    };
  }

  /**
   * docs/api/phase2.6b-contract.md endpoint 2. The status filter
   * (`!= 'hidden'`) and the per-viewer block filter (`NOT EXISTS` against
   * TeamChatBlock scoped to the requester) are applied in this single
   * query — the one thing ADR-0007 Decision 5 / the contract's implementer
   * note is explicit must not be two layered post-processing passes, since
   * that's the one place a future refactor could silently drop a filter and
   * leak a blocked/hidden message. Sender enrichment (screenName/avatarId)
   * and `reportedByMe` are deliberately separate follow-up queries — the
   * contract's "one query" requirement is specifically about visibility,
   * not about every field in the response.
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

    const messages = await qb.getMany();
    if (messages.length === 0) {
      return [];
    }

    // Sender enrichment: listByTeam is a full-team read, fine at this
    // project's repeatedly-stated "a handful of players" scale (same
    // reasoning WeeklyGoalService's roster/dashboard already rely on).
    const players = await this.playersService.listByTeam(teamId);
    const playerById = new Map(players.map((p) => [p.id, p]));

    const messageIds = messages.map((m) => m.id);
    const myReports = await this.reportRepository.find({
      where: { messageId: In(messageIds), reporterPlayerId: requesterId },
    });
    const reportedMessageIds = new Set(myReports.map((r) => r.messageId));

    return messages.map((message) => {
      const sender = playerById.get(message.senderPlayerId);
      if (!sender) {
        // Can't occur given the API contract: a message's sender is always
        // whoever posted it, which postMessage only ever allows for a
        // current team member, and player rows aren't deleted. Surfaced as
        // a 500, not defended against as normal client input.
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
        createdAt: message.createdAt.toISOString(),
        reportedByMe: reportedMessageIds.has(message.id),
      };
    });
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

    await this.sendReportNotificationBestEffort(
      teamId,
      message.senderPlayerId,
      dto.reason,
      message.content,
    );

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
