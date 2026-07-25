import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ClipAlreadyReportedException,
  ClipNotFoundException,
  ClipProcessingFailedException,
  ClipReportRateLimitedException,
  ClipUploadRateLimitedException,
  CaptionRejectedByFilterException,
  ConsentRequiredException,
  NotYourClipException,
  UploadNotFoundException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import {
  buildClipReportCoachEmail,
  buildClipReportParentEmail,
} from '../mail/templates/clip-report-notification-email.template';
import { MailService } from '../mail/mail.service';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { Coach } from '../coaches/entities/coach.entity';
import { TeamChatBlock } from '../team-chat/entities/team-chat-block.entity';
import { TeamCoach } from '../teams/entities/team-coach.entity';
import { TeamsService } from '../teams/teams.service';
import { RedisService } from '../redis/redis.service';
import type { ChatModerationCheck } from '../team-chat/chat-moderation-check.interface';
import { CHAT_MODERATION_CHECK } from '../team-chat/chat-moderation-check.interface';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DEFAULT_CLIP_FEED_LIMIT } from './dto/list-clips-query.dto';
import { ReportClipDto } from './dto/report-clip.dto';
import { ClipReport } from './entities/clip-report.entity';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';
import { ObjectStorageService } from './object-storage.service';
import { VideoProcessingService } from './video-processing.service';
import {
  CLIP_DURATION_MISMATCH_TOLERANCE_SECONDS,
  CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
  CLIP_UPLOAD_URL_EXPIRES_SECONDS,
  ClipMimeType,
  DEFAULT_CLIP_RETENTION_DAYS,
  extensionForMimeType,
} from './video-clip.constants';

const REPORT_UNIQUE_CONSTRAINT = 'UQ_clip_report_clip_reporter';

function assertConsentApproved(status: ParentalConsentStatus): void {
  if (status !== ParentalConsentStatus.APPROVED) {
    throw new ConsentRequiredException();
  }
}

export interface CreateUploadUrlResponse {
  clipId: string;
  uploadUrl: string;
  uploadMethod: 'PUT';
  requiredHeaders: { 'Content-Type': string };
  expiresAt: string;
}

export interface CompleteUploadResponse {
  clipId: string;
  status: 'published';
  playbackUrl: string;
  caption: string | null;
  taggedPlayerId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ClipFeedItem {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  taggedPlayerId: string | null;
  taggedScreenName: string | null;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
  reportedByMe: boolean;
}

export interface DeleteClipResponse {
  clipId: string;
  deleted: true;
}

export interface ReportClipResponse {
  reportId: string;
  clipId: string;
  createdAt: string;
}

// docs/adr/0010-video-storage-and-serving.md — the highest child-safety-risk
// feature built in this app so far. Every method starts with a team-
// membership check (PlayersService.assertTeamMembership), same pattern as
// every other team-scoped service; every clip read/write additionally
// re-checks `clip.teamId === requestingPlayer.teamId` (via a scoped
// repository query, never a bare `findOne({ id })`) on every single call —
// there is no code path here that can reach a clip's row, let alone its
// bytes, without that check running first (ADR-0010 Decision 2's
// "structural, not a code-review reminder" bar, mirroring ADR-0008's
// leaderboard join-avoidance bar).
@Injectable()
export class VideoClipsService {
  private readonly logger = new Logger(VideoClipsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly teamsService: TeamsService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly videoProcessingService: VideoProcessingService,
    @Inject(CHAT_MODERATION_CHECK)
    private readonly chatModerationCheck: ChatModerationCheck,
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
    @InjectRepository(ClipReport)
    private readonly clipReportRepository: Repository<ClipReport>,
    @InjectRepository(TeamChatBlock)
    private readonly teamChatBlockRepository: Repository<TeamChatBlock>,
    @InjectRepository(TeamCoach)
    private readonly teamCoachRepository: Repository<TeamCoach>,
    @InjectRepository(Coach)
    private readonly coachRepository: Repository<Coach>,
  ) {}

  private retentionDays(): number {
    const raw = this.configService.get<string>('CLIP_RETENTION_DAYS');
    return raw ? Number(raw) : DEFAULT_CLIP_RETENTION_DAYS;
  }

  /**
   * docs/api/phase3-contract.md endpoint 1. Order mirrors
   * TeamChatService.postMessage exactly (team membership -> consent gate ->
   * rate limit claimed *before* the moderation check, so repeated
   * filter-probing on the caption still costs the uploader's quota, not
   * free) -> teammate validation for taggedPlayerId -> caption moderation
   * -> persist + mint the presigned PUT.
   */
  async createUploadUrl(
    teamId: string,
    requesterId: string,
    dto: CreateUploadUrlDto,
  ): Promise<CreateUploadUrlResponse> {
    const player = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    assertConsentApproved(player.parentalConsentStatus);

    const claimed =
      await this.redisService.tryClaimClipUploadAllowance(requesterId);
    if (!claimed) {
      throw new ClipUploadRateLimitedException();
    }

    if (dto.taggedPlayerId) {
      const tagged = await this.playersService.findByIdOrThrow(
        dto.taggedPlayerId,
      );
      if (tagged.teamId !== teamId) {
        throw new BadRequestException(
          'taggedPlayerId must belong to the same team as the requesting player.',
        );
      }
    }

    if (dto.caption) {
      const moderation = await this.chatModerationCheck.check(dto.caption);
      if (!moderation.allowed) {
        throw new CaptionRejectedByFilterException();
      }
    }

    const clip = await this.videoClipRepository.save(
      this.videoClipRepository.create({
        teamId,
        uploaderPlayerId: requesterId,
        taggedPlayerId: dto.taggedPlayerId ?? null,
        // Server-generated, never client-supplied (ADR-0010 Decision 1) —
        // filled in below once we have the row's real id.
        storageKey: '',
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        durationSeconds: dto.durationSeconds,
        caption: dto.caption ?? null,
        status: VideoClipStatus.PENDING_UPLOAD,
      }),
    );

    const storageKey = `clips/${teamId}/${clip.id}.${extensionForMimeType(
      dto.mimeType,
    )}`;
    await this.videoClipRepository.update({ id: clip.id }, { storageKey });

    const uploadUrl = await this.objectStorageService.createPresignedPutUrl(
      storageKey,
      dto.mimeType,
      CLIP_UPLOAD_URL_EXPIRES_SECONDS,
    );
    const expiresAt = new Date(
      Date.now() + CLIP_UPLOAD_URL_EXPIRES_SECONDS * 1000,
    );

    return {
      clipId: clip.id,
      uploadUrl,
      uploadMethod: 'PUT',
      requiredHeaders: { 'Content-Type': dto.mimeType },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * docs/api/phase3-contract.md endpoint 2 (ADR-0010 Decision 3 — read that
   * section before touching this method, not just this comment). Order: 1)
   * team membership; 2) the clip must exist, belong to this team/uploader,
   * and still be pending_upload (else 404 clip_not_found — deliberately
   * generic, doesn't distinguish which condition failed); 3) HEAD the
   * object in MinIO (else 409 upload_not_found); 4) download, probe, remux
   * (the mandatory metadata-stripping step — any failure here is 422
   * clip_processing_failed, and the clip is left pending_upload, never
   * published unstripped); 5) upload the remuxed bytes back to the same
   * storage_key; 6) flip status to published with expiresAt set; 7) mint a
   * fresh presigned GET and return.
   */
  async completeUpload(
    teamId: string,
    requesterId: string,
    clipId: string,
  ): Promise<CompleteUploadResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    const clip = await this.videoClipRepository.findOne({
      where: {
        id: clipId,
        teamId,
        uploaderPlayerId: requesterId,
        status: VideoClipStatus.PENDING_UPLOAD,
      },
    });
    if (!clip) {
      throw new ClipNotFoundException();
    }

    const head = await this.objectStorageService.headObject(clip.storageKey);
    if (!head) {
      throw new UploadNotFoundException();
    }

    let inputPath: string | null = null;
    let outputPath: string | null = null;
    try {
      const objectBytes = await this.objectStorageService.getObjectBuffer(
        clip.storageKey,
      );
      const extension = extensionForMimeType(clip.mimeType as ClipMimeType);
      inputPath = await this.videoProcessingService.writeTempFile(
        objectBytes,
        extension,
      );
      outputPath = `${inputPath}.stripped.${extension}`;

      const probeResult = await this.videoProcessingService.probe(inputPath);
      this.logDurationDiscrepancyIfAny(clip, probeResult.durationSeconds);

      try {
        await this.videoProcessingService.remuxStripMetadata(
          inputPath,
          outputPath,
          probeResult.hasAudioStream,
        );
      } catch (error) {
        this.logger.warn(
          `Metadata-stripping remux failed for clip ${clip.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // The uploaded object is unusable (can never be published
        // unstripped) — clear it out now rather than waiting on the
        // pending_upload TTL sweep; the row stays pending_upload so a
        // retry-from-a-fresh-upload (per the contract) doesn't collide
        // with a stale object at the same storage_key.
        await this.objectStorageService.deleteObjectIfExists(clip.storageKey);
        throw new ClipProcessingFailedException();
      }

      const strippedBytes =
        await this.videoProcessingService.readTempFile(outputPath);
      await this.objectStorageService.putObjectBuffer(
        clip.storageKey,
        strippedBytes,
        clip.mimeType,
      );

      const expiresAt = new Date(
        clip.createdAt.getTime() + this.retentionDays() * 24 * 60 * 60 * 1000,
      );
      await this.videoClipRepository.update(
        { id: clip.id },
        { status: VideoClipStatus.PUBLISHED, expiresAt },
      );

      const playbackUrl = await this.objectStorageService.createPresignedGetUrl(
        clip.storageKey,
        CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
      );

      return {
        clipId: clip.id,
        status: 'published',
        playbackUrl,
        caption: clip.caption,
        taggedPlayerId: clip.taggedPlayerId,
        createdAt: clip.createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    } finally {
      if (inputPath)
        await this.videoProcessingService.deleteTempFileIfExists(inputPath);
      if (outputPath)
        await this.videoProcessingService.deleteTempFileIfExists(outputPath);
    }
  }

  private logDurationDiscrepancyIfAny(
    clip: VideoClip,
    actualDurationSeconds: number | null,
  ): void {
    if (actualDurationSeconds === null) return;
    const diff = Math.abs(actualDurationSeconds - clip.durationSeconds);
    if (diff > CLIP_DURATION_MISMATCH_TOLERANCE_SECONDS) {
      // Non-blocking (ADR-0010 Decision 3's optional extension) — logged,
      // not rejected: backend-developer's call per the ADR, and a hard
      // rejection here would risk bouncing legitimate clips over an
      // approximate client-side duration estimate.
      this.logger.warn(
        `Clip ${clip.id}: declared durationSeconds=${clip.durationSeconds} but ffprobe measured ${actualDurationSeconds}s (diff ${diff.toFixed(1)}s).`,
      );
    }
  }

  /**
   * docs/api/phase3-contract.md endpoint 3. The status filter
   * (`= 'published'`) and the per-viewer TeamChatBlock filter (`NOT
   * EXISTS`, scoped to `uploaderPlayerId` — docs/design/phase3-flows.md's
   * "block extends to clips" decision) are applied in this single query,
   * mirroring TeamChatService.listMessages's combined status/block query
   * exactly — not two layered post-processing passes.
   */
  async listClips(
    teamId: string,
    requesterId: string,
    before: string | undefined,
    limit: number = DEFAULT_CLIP_FEED_LIMIT,
  ): Promise<ClipFeedItem[]> {
    const player = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    assertConsentApproved(player.parentalConsentStatus);

    const qb = this.videoClipRepository
      .createQueryBuilder('clip')
      .where('clip.team_id = :teamId', { teamId })
      .andWhere('clip.status = :status', {
        status: VideoClipStatus.PUBLISHED,
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM team_chat_block block
          WHERE block.blocker_player_id = :requesterId
            AND block.blocked_player_id = clip.uploader_player_id
        )`,
        { requesterId },
      );

    if (before) {
      qb.andWhere('clip.created_at < :before', { before: new Date(before) });
    }

    qb.orderBy('clip.created_at', 'DESC').limit(limit);

    const clips = await qb.getMany();
    if (clips.length === 0) {
      return [];
    }

    // Full-team enrichment read, same "fine at this project's scale"
    // reasoning as TeamChatService.listMessages.
    const players = await this.playersService.listByTeam(teamId);
    const playerById = new Map(players.map((p) => [p.id, p]));

    const clipIds = clips.map((c) => c.id);
    const myReports = await this.clipReportRepository.find({
      where: { clipId: In(clipIds), reporterPlayerId: requesterId },
    });
    const reportedClipIds = new Set(myReports.map((r) => r.clipId));

    return Promise.all(
      clips.map(async (clip) => {
        const uploader = playerById.get(clip.uploaderPlayerId);
        if (!uploader) {
          // Can't occur given the API contract: identical reasoning to
          // TeamChatService.listMessages's equivalent guard — an uploader
          // is always a current team member, and player rows aren't
          // deleted.
          throw new Error(
            `VideoClip ${clip.id} references uploader ${clip.uploaderPlayerId} not found on team ${teamId}`,
          );
        }
        const tagged = clip.taggedPlayerId
          ? playerById.get(clip.taggedPlayerId)
          : undefined;
        const playbackUrl =
          await this.objectStorageService.createPresignedGetUrl(
            clip.storageKey,
            CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
          );

        return {
          clipId: clip.id,
          uploaderPlayerId: clip.uploaderPlayerId,
          uploaderScreenName: uploader.screenName,
          uploaderAvatarId: uploader.avatarId,
          taggedPlayerId: clip.taggedPlayerId,
          taggedScreenName: tagged?.screenName ?? null,
          caption: clip.caption,
          playbackUrl,
          createdAt: clip.createdAt.toISOString(),
          reportedByMe: reportedClipIds.has(clip.id),
        };
      }),
    );
  }

  /**
   * docs/api/phase3-contract.md endpoint 4. Uploader-only, no consent gate
   * (removing your own content is always allowed), unconditional even if
   * the clip has open reports — ClipReport.clip_id's ON DELETE SET NULL
   * handles that automatically at the DB level, no manual step needed here.
   */
  async deleteClip(
    teamId: string,
    requesterId: string,
    clipId: string,
  ): Promise<DeleteClipResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    const clip = await this.videoClipRepository.findOne({
      where: { id: clipId, teamId },
    });
    if (!clip) {
      throw new ClipNotFoundException();
    }
    if (clip.uploaderPlayerId !== requesterId) {
      throw new NotYourClipException();
    }

    await this.objectStorageService.deleteObjectIfExists(clip.storageKey);
    await this.videoClipRepository.delete({ id: clip.id });

    return { clipId, deleted: true };
  }

  /**
   * docs/api/phase3-contract.md endpoint 5 (ADR-0010 Decision 4 — read that
   * section before touching this method). Order: team membership -> consent
   * gate -> clip exists/is published on this team (404) -> already-
   * reported-by-this-viewer pre-check (409, before claiming the cooldown,
   * mirroring TeamChatService.reportMessage) -> report cooldown (429) ->
   * insert -> **immediately hide the clip** (the deliberate divergence from
   * chat) -> best-effort, rate-limited notification email.
   */
  async reportClip(
    teamId: string,
    requesterId: string,
    clipId: string,
    dto: ReportClipDto,
  ): Promise<ReportClipResponse> {
    const player = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    assertConsentApproved(player.parentalConsentStatus);

    const clip = await this.videoClipRepository.findOne({
      where: { id: clipId, teamId, status: VideoClipStatus.PUBLISHED },
    });
    if (!clip) {
      throw new ClipNotFoundException();
    }

    const existingReport = await this.clipReportRepository.findOne({
      where: { clipId, reporterPlayerId: requesterId },
    });
    if (existingReport) {
      throw new ClipAlreadyReportedException();
    }

    const claimed =
      await this.redisService.tryClaimClipReportCooldown(requesterId);
    if (!claimed) {
      throw new ClipReportRateLimitedException();
    }

    let report: ClipReport;
    try {
      report = await this.clipReportRepository.save(
        this.clipReportRepository.create({
          clipId,
          reporterPlayerId: requesterId,
          reportedUploaderPlayerId: clip.uploaderPlayerId,
          reason: dto.reason,
          note: dto.note ?? null,
        }),
      );
    } catch (error) {
      if (isPostgresUniqueViolation(error, REPORT_UNIQUE_CONSTRAINT)) {
        // Backstop for a race between the pre-check above and this insert,
        // same posture as TeamChatService.reportMessage's identical catch.
        throw new ClipAlreadyReportedException();
      }
      throw error;
    }

    // ADR-0010 Decision 4 — immediate, unconditional auto-hide. Not gated
    // on anything below succeeding; the clip disappears from the feed on
    // the next fetch regardless of whether the notification email sends.
    await this.videoClipRepository.update(
      { id: clipId },
      { status: VideoClipStatus.HIDDEN },
    );

    await this.sendReportNotificationBestEffort(teamId, clip.uploaderPlayerId);

    return {
      reportId: report.id,
      clipId,
      createdAt: report.createdAt.toISOString(),
    };
  }

  /**
   * ADR-0010 Decision 4's two-destination best-effort email — reuses the
   * MailService best-effort pattern and PlayerPrivateInfoService's
   * getParentContact as this module's own (third overall, per the ADR's
   * module-boundary note) legitimate caller. Never throws; only logs on
   * failure. Rate-limited to at most one email per uploader per rolling 24
   * hours (a single claim gates both the parent and coach sends together,
   * matching the contract's "one email per uploader" wording, not "one per
   * recipient").
   */
  private async sendReportNotificationBestEffort(
    teamId: string,
    uploaderPlayerId: string,
  ): Promise<void> {
    try {
      const parentContact =
        await this.playerPrivateInfoService.getParentContact(uploaderPlayerId);
      const coachEmails = await this.getTeamCoachEmails(teamId);

      if (!parentContact && coachEmails.length === 0) {
        this.logger.warn(
          `No parent/coach contact on file for clip report on uploader ${uploaderPlayerId} — no email sent.`,
        );
        return;
      }

      const claimed =
        await this.redisService.tryClaimClipReportNotifyCooldown(
          uploaderPlayerId,
        );
      if (!claimed) {
        this.logger.log(
          `Clip-report notification for uploader ${uploaderPlayerId} suppressed by the 24h cooldown.`,
        );
        return;
      }

      const uploader =
        await this.playersService.findByIdOrThrow(uploaderPlayerId);

      if (parentContact) {
        const parentEmail = buildClipReportParentEmail({
          uploaderScreenName: uploader.screenName,
        });
        await this.mailService.sendMail({
          to: parentContact,
          subject: parentEmail.subject,
          html: parentEmail.html,
          text: parentEmail.text,
        });
      }

      if (coachEmails.length > 0) {
        const team = await this.teamsService.findById(teamId);
        const coachEmail = buildClipReportCoachEmail({
          teamName: team?.name ?? '',
        });
        for (const to of coachEmails) {
          await this.mailService.sendMail({
            to,
            subject: coachEmail.subject,
            html: coachEmail.html,
            text: coachEmail.text,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send clip-report notification for uploader ${uploaderPlayerId}: ${message}`,
      );
    }
  }

  /**
   * Identical to TeamChatService.getTeamCoachEmails — reuses only the
   * dormant TeamCoach/Coach schema's stored email address (ADR-0004's
   * addendum), nothing about coach login/auth is reactivated. A team may
   * have zero or more coaches on file; every one gets the notification.
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
