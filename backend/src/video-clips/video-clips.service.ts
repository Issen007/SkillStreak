import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  ClipAlreadyReportedException,
  ClipNotFoundException,
  ClipProcessingFailedException,
  ClipReportRateLimitedException,
  ClipUploadRateLimitedException,
  CaptionRejectedByFilterException,
  ConsentRequiredException,
  NotYourChallengeException,
  NotYourClipException,
  TeamJoinApprovalRequiredException,
  UploadNotFoundException,
} from '../common/errors/exceptions';
import { isPostgresUniqueViolation } from '../common/errors/postgres-error.util';
import {
  buildClipReportCoachEmail,
  buildClipReportParentEmail,
} from '../mail/templates/clip-report-notification-email.template';
import { MailService } from '../mail/mail.service';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { PlayersService } from '../players/players.service';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { Coach } from '../coaches/entities/coach.entity';
import { TeamChatBlock } from '../team-chat/entities/team-chat-block.entity';
import {
  ChatMessageAuthorType,
  ChatMessageStatus,
  SystemChatEventType,
  TeamChatMessage,
} from '../team-chat/entities/team-chat-message.entity';
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
  CLIP_MAX_FILE_SIZE_BYTES,
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

// Added 2026-07-27 — a second, independent gate alongside
// assertConsentApproved above (see TeamJoinApprovalRequiredException).
// Mirrors that function's exact call sites (createUploadUrl, listClips,
// reportClip) rather than introducing new gating scope.
function assertTeamJoinApproved(status: TeamJoinStatus): void {
  if (status !== TeamJoinStatus.APPROVED) {
    throw new TeamJoinApprovalRequiredException();
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

// docs/adr/0021-clip-challenge-notifications.md Decision 1 / the design
// doc's §0 fixed contract — GET .../clips/challenges/pending. Deliberately
// narrower than ClipFeedItem: no taggedPlayerId/taggedScreenName (always
// the requester themselves, by construction of the query) and no
// reportedByMe (not designed for this surface, per the design doc's §5
// scope-cut note on ChallengeClipModal).
export interface PendingChallengeItem {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
}

export interface ChallengeAckResponse {
  clipId: string;
  acknowledged: true;
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
    private readonly dataSource: DataSource,
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
    // docs/adr/0021-clip-challenge-notifications.md Decision 2's "Module
    // wiring" — VideoClipsModule registers TeamChatMessage via its own
    // TypeOrmModule.forFeature (video-clips.module.ts), NOT by importing
    // TeamChatModule (which already imports VideoClipsModule — the reverse
    // direction would cycle). Only ever written to inside completeUpload's
    // own transaction, as a plain repository insert — never through
    // TeamChatService.postMessage's HTTP path (rate-limit/moderation/DTO
    // stack, none of which applies to a system-authored row).
    @InjectRepository(TeamChatMessage)
    private readonly teamChatMessageRepository: Repository<TeamChatMessage>,
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
    assertTeamJoinApproved(player.teamJoinStatus);

    const claimed =
      await this.redisService.tryClaimClipUploadAllowance(requesterId);
    if (!claimed) {
      throw new ClipUploadRateLimitedException();
    }

    await this.assertTaggedPlayerAllowed(teamId, dto.taggedPlayerId);
    await this.assertCaptionAllowed(dto.caption);

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
   * object in MinIO (else 409 upload_not_found); 4) spot-check the HEAD
   * result's real size/content-type against the declared upload (422
   * clip_processing_failed, object deleted, if it fails — see the inline
   * comment below for why this step is load-bearing, not decorative); 5)
   * download, probe, remux (the mandatory metadata-stripping step — any
   * failure here is also 422 clip_processing_failed, and the clip is left
   * pending_upload, never published unstripped); 6) upload the remuxed
   * bytes back to the same storage_key; 7) flip status to published with
   * expiresAt set; 8) mint a fresh presigned GET and return.
   */
  /**
   * The tag rule, extracted 2026-08-09 so `createUploadUrl` and
   * `completeUpload` cannot drift apart. Background upload
   * (docs/internal/BACKLOG.md) means the caption and tag can now arrive at
   * `complete` instead of at `create` — and a second, subtly weaker copy
   * of this check on that path would be a real authorization gap, not a
   * style problem. One method, both callers.
   */
  private async assertTaggedPlayerAllowed(
    teamId: string,
    taggedPlayerId: string | undefined,
  ): Promise<void> {
    if (!taggedPlayerId) return;
    const tagged = await this.playersService.findByIdOrThrow(taggedPlayerId);
    // docs/adr/0021-clip-challenge-notifications.md Decision 3 — a real,
    // if narrow, tightening: taggedPlayerId must now also be
    // teamJoinStatus === APPROVED, not just teamId-matching. Closes a
    // small, pre-existing gap this feature's new visibility (a durable
    // pending-challenges list + a chat broadcast, not a dormant FK) made
    // worth ruling out — a not-yet-captain-approved joiner could
    // previously be tagged. This is the enforcement point (not
    // PlayersService.listTeammates's own default — that method stays
    // unfiltered by default, per a code-critic finding, 2026-08-06
    // pre-merge pass: it backs two other, unrelated pickers — captain
    // transfer and GDPR erasure successor — that must not be narrowed by
    // this ADR's own reasoning). The message deliberately still contains
    // the substring "taggedPlayerId" so the mobile tag-picker's existing
    // catch (V5CaptionChallenge.tsx) handles this 400 correctly
    // (design doc §7's "secondary, acceptable" option — the one actually
    // shipped here, since `GET .../teammates`'s own opt-in
    // `approvedOnly` narrowing, once the tag-picker's mobile call site
    // is updated to request it, is frontend-developer's follow-up work,
    // not wired by this backend change).
    if (
      tagged.teamId !== teamId ||
      tagged.teamJoinStatus !== TeamJoinStatus.APPROVED
    ) {
      throw new BadRequestException(
        'taggedPlayerId must belong to the same team as the requesting player and have an approved team join.',
      );
    }
  }

  /**
   * The caption moderation gate, extracted for the same reason as the tag
   * check above — and this one matters more: a caption supplied at
   * `complete` that skipped `chatModerationCheck` would be a straight
   * moderation bypass on child-authored text, reachable by any
   * authenticated player. There is deliberately no path that writes a
   * caption without passing through here.
   */
  /**
   * A tag that was stored at create time, re-checked leniently: returns it
   * if the teammate is still there and still eligible, or `null` if they
   * are not. Deliberately does NOT throw, unlike the strict check used for
   * a client-supplied tag — the caller did not just assert this value, and
   * the realistic way it goes stale is the tagged teammate erasing their
   * own account mid-upload (ON DELETE SET NULL on the FK), which is not the
   * uploader's error to be punished for.
   */
  private async resolveStoredTagOrClear(
    teamId: string,
    storedTagId: string | null,
  ): Promise<string | null> {
    if (!storedTagId) return null;
    const tagged = await this.playersService.findById(storedTagId);
    if (
      !tagged ||
      tagged.teamId !== teamId ||
      tagged.teamJoinStatus !== TeamJoinStatus.APPROVED
    ) {
      return null;
    }
    return storedTagId;
  }

  private async assertCaptionAllowed(
    caption: string | undefined,
  ): Promise<void> {
    if (!caption) return;
    const moderation = await this.chatModerationCheck.check(caption);
    if (!moderation.allowed) {
      throw new CaptionRejectedByFilterException();
    }
  }

  /**
   * `metadata` supports the background-upload flow (BACKLOG.md): the client
   * may now mint the upload URL and start pushing bytes the moment a file
   * is picked — before the player has written a caption or chosen a tag —
   * and supply both here instead. Omitted entirely by the original flow,
   * which still sets them at create time; when present they overwrite,
   * since they are the player's later, more considered answer.
   *
   * **Both go through the exact same validation as the create path**, via
   * the two shared helpers above rather than a second copy. A caption
   * arriving here that skipped `chatModerationCheck` would be a moderation
   * bypass on child-authored text, and a tag that skipped the team/approval
   * check would be an authorization one.
   */
  async completeUpload(
    teamId: string,
    requesterId: string,
    clipId: string,
    metadata: {
      caption?: string | null;
      taggedPlayerId?: string | null;
    } = {},
  ): Promise<CompleteUploadResponse> {
    const player = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    // Security-reviewer finding, 2026-08-09: this endpoint accepts the bytes
    // into the published feed and hands back a playback URL, so CLAUDE.md's
    // "parental approval before any account can upload media" applies here
    // as much as at `upload-url`. Every sibling media endpoint already gates
    // both; this one checked team membership alone. The create->complete
    // window is now an entire captioning session, which is exactly when a
    // revocation would land.
    assertConsentApproved(player.parentalConsentStatus);
    assertTeamJoinApproved(player.teamJoinStatus);

    // The clip lookup comes BEFORE any metadata validation, deliberately.
    // With the asserts first, a caller needed no clip at all to reach the
    // caption moderation filter, and could read a clean binary oracle over
    // the wordlist off the 400-vs-404 response — see the rate limit below.
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

    // `undefined` means "keep whatever create stored"; explicit `null` means
    // "clear it". Both fields agree on that, which they previously did not:
    // `@IsOptional()` skips validation for `null` as well as `undefined`, so
    // `caption: null` reached a `.trim()` on null and threw — after the
    // download, ffprobe, remux and re-upload had already run, leaving the
    // row pending and the object intact, i.e. an infinitely repeatable
    // ~75MB-per-request amplification loop. Resolved here, before any
    // storage work, rather than in the middle of it.
    const effectiveCaption =
      metadata.caption !== undefined
        ? (metadata.caption?.trim() ?? '') || null
        : clip.caption;
    const suppliedTag =
      metadata.taggedPlayerId !== undefined
        ? metadata.taggedPlayerId || null
        : undefined;

    // Claimed unconditionally. It used to be claimed only when caption or
    // tag was present, which left an empty-bodied complete costing the
    // player nothing — and an empty body still triggers the whole
    // download/ffprobe/ffmpeg/upload round trip. Security review finding
    // 2: the per-player allowance is the ceiling on how often one account
    // can ask for that work, so gating it on metadata meant the expensive
    // path was the one path with no per-player ceiling at all.
    //
    // The original reason for claiming here still holds too: `upload-url`
    // claims before running the filter "so repeated filter-probing on the
    // caption still costs the uploader's quota, not free", and owning one
    // pending clip would otherwise buy unlimited probes behind the generic
    // 300/min/IP backstop.
    const claimed =
      await this.redisService.tryClaimClipCompleteAllowance(requesterId);
    if (!claimed) {
      throw new ClipUploadRateLimitedException();
    }

    if (suppliedTag !== undefined) {
      // Client-supplied: strict, exactly as at create.
      await this.assertTaggedPlayerAllowed(teamId, suppliedTag ?? undefined);
    }
    if (metadata.caption !== undefined) {
      // Only what the CALLER supplied is re-moderated. A caption that came
      // from `create` was already filtered there, and re-running it would
      // cost a filter call per complete for no added guarantee. The
      // invariant that matters still holds: every value that reaches the
      // column passed the filter on the path that introduced it.
      await this.assertCaptionAllowed(effectiveCaption ?? undefined);
    }

    // A tag stored at create time is re-checked leniently rather than
    // trusted: `video_clip.tagged_player_id` is ON DELETE SET NULL, so a
    // teammate erasing their account mid-upload leaves this in-memory
    // snapshot holding a UUID the row no longer has. Writing it back would
    // violate the FK and 500 on every retry, burning a full remux each
    // time. Resolving to null instead is the honest outcome — the person
    // being challenged no longer exists.
    const effectiveTag =
      suppliedTag !== undefined
        ? suppliedTag
        : await this.resolveStoredTagOrClear(teamId, clip.taggedPlayerId);

    const head = await this.objectStorageService.headObject(clip.storageKey);
    if (!head) {
      throw new UploadNotFoundException();
    }

    // Post-upload technical-validity spot-check (ADR-0010 Decision 3 /
    // phase3-contract.md endpoint 2 step 1 — "confirm ... its real
    // size/content-type are consistent with what was declared at step 1")
    // — code-critic finding, confirmed missing entirely before this fix.
    // Neither of this app's two other size/type controls actually reaches
    // this far: `CreateUploadUrlDto`'s `@Max(fileSizeBytes)` only validates
    // the client's own *declared* number, and the presigned PUT URL doesn't
    // bind the client to it (confirmed directly against a real MinIO
    // instance: the signed URL's `X-Amz-SignedHeaders` is `host` only —
    // neither Content-Length nor Content-Type is part of the signature);
    // the bucket-level max-object-size policy
    // (ObjectStorageService.configureMaxObjectSizePolicy) is separately
    // confirmed non-functional against MinIO. Without this check, a player
    // could declare a small fileSizeBytes and then PUT an arbitrarily large
    // object straight to the presigned URL: completeUpload would otherwise
    // buffer the *entire* object into memory a few lines below
    // (getObjectBuffer) on this single-replica API pod before ever
    // rejecting it — a real memory-exhaustion, not just storage-
    // exhaustion, path bounded only by the daily upload-count rate limit,
    // not by size.
    //
    // Rejecting here is an early, cheap refusal — NOT the control.
    // Security review finding 3: this HEAD and the GET below are two
    // observations of a key that stays client-writable between them (the
    // presigned PUT is valid for five minutes and can be reused), so a
    // client that overwrites in the gap defeats a check made here. What
    // actually bounds memory is the maxBytes ceiling passed to
    // getObjectBuffer, which abandons the stream the moment it is
    // crossed. This check still earns its place by rejecting the honest
    // oversize case without spending a download.
    //
    // Reuses the same 422 clip_processing_failed
    // path/cleanup as a failed remux (delete the bad object, leave the row
    // pending_upload) rather than inventing a new error code — the mobile
    // client's existing "retry from a fresh upload" handling for that code
    // already covers this case correctly with no client change needed.
    if (
      head.sizeBytes > CLIP_MAX_FILE_SIZE_BYTES ||
      (head.contentType !== null && head.contentType !== clip.mimeType)
    ) {
      this.logger.warn(
        `Clip ${clip.id}: object at ${clip.storageKey} failed the post-upload ` +
          `technical-validity spot-check (reported size=${head.sizeBytes}B, ` +
          `contentType=${head.contentType ?? 'null'}; declared mimeType=` +
          `${clip.mimeType}, max allowed size=${CLIP_MAX_FILE_SIZE_BYTES}B).`,
      );
      await this.objectStorageService.deleteObjectIfExists(clip.storageKey);
      throw new ClipProcessingFailedException();
    }

    // Admission control for the expensive half — security review finding
    // 2. Everything below downloads the whole object into heap, writes it
    // to disk, runs ffprobe and ffmpeg, and uploads the result. The only
    // thing that previously excluded a second caller was the conditional
    // UPDATE at the very end, which lands *after* all of it: N concurrent
    // completes on one pending clip therefore each did the full round
    // trip, and at the 75 MB ceiling on a two-replica deployment that is
    // an OOM rather than a slowdown.
    //
    // Refused, not queued. A second caller on the same clip is either a
    // retry or an attack, and neither is owed the work — the first call
    // is still running and will publish.
    const processingClaimed = await this.redisService.tryClaimClipProcessing(
      clip.id,
    );
    if (!processingClaimed) {
      throw new ClipUploadRateLimitedException();
    }

    let inputPath: string | null = null;
    let outputPath: string | null = null;
    try {
      // Bounded, not trusted: see the HEAD check above for why its result
      // cannot be relied on by the time these bytes arrive.
      const objectBytes = await this.objectStorageService.getObjectBuffer(
        clip.storageKey,
        CLIP_MAX_FILE_SIZE_BYTES,
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
      // docs/adr/0021-clip-challenge-notifications.md Decision 2 —
      // "transactional, inside the same DB transaction as the
      // publish-status flip." Both the status flip and the (conditional)
      // system chat-message insert are pure DB writes with no external I/O
      // in this step (the MinIO/ffmpeg work above has already completed),
      // so there's no reason to split this into a best-effort try/catch the
      // way an email send would be — same "one more step in the same
      // transaction" pattern ADR-0005's goal-bonus check already
      // established (see TrainingLogsService.logTraining).
      // Resolved before any of the storage work above; applied here in the
      // SAME transaction as the publish flip, never as a follow-up write
      // that could leave a clip published with a caption the player had
      // already replaced.
      clip.caption = effectiveCaption;
      clip.taggedPlayerId = effectiveTag;

      const lostRace = await this.dataSource.transaction(async (manager) => {
        // `status: PENDING_UPLOAD` in the WHERE clause, and `affected`
        // actually checked — security-reviewer finding, 2026-08-09. This
        // update previously matched on id alone and ignored its result, so
        // two things went wrong silently. A `complete` racing a delete (the
        // child pressing "discard" during a background upload, or the
        // hourly abandoned-upload sweep) would find 0 rows, commit an empty
        // transaction, and still return 200 published with a working
        // playback URL — for a clip whose row is gone and whose object this
        // method had just re-created, leaving a file no retention sweep can
        // ever reach, since both sweeps iterate rows. And two CONCURRENT
        // completes would both match, both publish, and both post the
        // challenge message, naming the tagged child twice in team chat.
        const result = await manager.getRepository(VideoClip).update(
          { id: clip.id, status: VideoClipStatus.PENDING_UPLOAD },
          {
            status: VideoClipStatus.PUBLISHED,
            expiresAt,
            caption: clip.caption,
            taggedPlayerId: clip.taggedPlayerId,
          },
        );
        if (!result.affected) {
          return true;
        }
        // Reads clip.taggedPlayerId, so it must run after the assignment
        // above — otherwise a tag chosen during the background upload would
        // publish without ever notifying the tagged teammate.
        await this.postChallengeSystemMessageIfTagged(manager, teamId, clip);
        return false;
      });

      if (lostRace) {
        // The row went away (or another request published it) while this
        // one was remuxing. Remove the object this method re-uploaded a few
        // lines above, so a deleted clip's bytes don't outlive it, and
        // report the same 404 a fresh caller would get.
        await this.objectStorageService.deleteObjectIfExists(clip.storageKey);
        throw new ClipNotFoundException();
      }

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
      // Released on failure as well as success: a failed complete leaves
      // the row `pending_upload` so the client may legitimately retry, and
      // holding the claim for its full TTL would turn one transient ffmpeg
      // error into minutes of refused retries.
      await this.redisService.releaseClipProcessing(clip.id);
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
   * docs/adr/0021-clip-challenge-notifications.md Decision 2 — the team
   * chat system message announcing a just-published challenge clip. Only
   * called from inside completeUpload's own transaction (`manager` is
   * always that transaction's manager, never a bare repository), and only
   * when `clip.taggedPlayerId IS NOT NULL` — a no-op for every ordinary,
   * untagged upload. `content` is a fixed, server-rendered Swedish string
   * (not an i18n key, per Decision 2 and the design doc §4.1), baked in
   * once here from both players' *current* screen names and never
   * re-resolved live afterwards — this survives either player's later
   * erasure/rename exactly like any other human-authored chat message's
   * own text already does (ADR-0013 never scrubs free-text mentions).
   * `senderPlayerId` stays NULL; `authorType: 'system'` is what
   * distinguishes this from ADR-0013 Decision 6's unrelated "real player,
   * since erased" NULL-sender case (see ChatMessageAuthorType's own
   * comment). This is a direct repository write, never
   * TeamChatService.postMessage's HTTP path — no rate limit, no moderation
   * check, no DTO exposes authorType/systemEventType to any client
   * (Decision 3).
   */
  private async postChallengeSystemMessageIfTagged(
    manager: EntityManager,
    teamId: string,
    clip: VideoClip,
  ): Promise<void> {
    if (!clip.taggedPlayerId) {
      return;
    }

    const [uploader, tagged] = await Promise.all([
      this.playersService.findByIdOrThrow(clip.uploaderPlayerId, manager),
      this.playersService.findByIdOrThrow(clip.taggedPlayerId, manager),
    ]);

    const content = `🎯 ${uploader.screenName} utmanade ${tagged.screenName} med en video!`;

    const messageRepository = manager.getRepository(TeamChatMessage);
    await messageRepository.save(
      messageRepository.create({
        teamId,
        senderPlayerId: null,
        authorType: ChatMessageAuthorType.SYSTEM,
        systemEventType: SystemChatEventType.CLIP_CHALLENGE_ISSUED,
        content,
        clipId: clip.id,
        status: ChatMessageStatus.VISIBLE,
      }),
    );
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
    assertTeamJoinApproved(player.teamJoinStatus);

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
   * docs/adr/0021-clip-challenge-notifications.md Decision 1 / design doc
   * §0 — "pending challenges for me." Gates identical to listClips's own
   * requester-side gates (team membership -> consent -> team-join
   * approval), on the viewer/tagged player, unchanged pattern, not a new
   * precedent. WHERE tagged_player_id = requesterId AND status =
   * 'published' AND challenge_acknowledged_at IS NULL — backed by
   * IDX_video_clip_pending_challenge. No pagination (team sizes are
   * small, same standing capacity assumption as every other small-list
   * endpoint here).
   */
  async listPendingChallenges(
    teamId: string,
    requesterId: string,
  ): Promise<PendingChallengeItem[]> {
    const player = await this.playersService.assertTeamMembership(
      requesterId,
      teamId,
    );
    assertConsentApproved(player.parentalConsentStatus);
    assertTeamJoinApproved(player.teamJoinStatus);

    const clips = await this.videoClipRepository.find({
      where: {
        teamId,
        taggedPlayerId: requesterId,
        status: VideoClipStatus.PUBLISHED,
        challengeAcknowledgedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
    if (clips.length === 0) {
      return [];
    }

    const players = await this.playersService.listByTeam(teamId);
    const playerById = new Map(players.map((p) => [p.id, p]));

    return Promise.all(
      clips.map(async (clip) => {
        const uploader = playerById.get(clip.uploaderPlayerId);
        if (!uploader) {
          // Can't occur given the API contract: identical reasoning to
          // listClips's equivalent guard — an uploader is always a
          // current team member, and player rows aren't deleted.
          throw new Error(
            `VideoClip ${clip.id} references uploader ${clip.uploaderPlayerId} not found on team ${teamId}`,
          );
        }
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
          caption: clip.caption,
          playbackUrl,
          createdAt: clip.createdAt.toISOString(),
        };
      }),
    );
  }

  /**
   * docs/adr/0021-clip-challenge-notifications.md Decision 1 — tagged-
   * player-only, idempotent: acking an already-acked challenge is a 200
   * no-op, not an error (same idiom as TeamChatBlock's idempotent block,
   * ADR-0007 Decision 4) — this is a personal "I've seen it" state, not an
   * accusation or a one-time resource, so a second ack (e.g. a multi-device
   * race, design doc §6) carries no signal worth protecting against.
   */
  async ackChallenge(
    teamId: string,
    requesterId: string,
    clipId: string,
  ): Promise<ChallengeAckResponse> {
    await this.playersService.assertTeamMembership(requesterId, teamId);

    // `status: PUBLISHED` — consistent with listPendingChallenges and the
    // migration's own doc comment, both of which treat `published` as a
    // precondition for challenge_acknowledged_at being meaningful at all
    // (code-critic finding, 2026-08-06 pre-merge pass). No realistic
    // exploit today (a clipId is never exposed to the tagged player before
    // publish), but this keeps the invariant enforced structurally rather
    // than by convention.
    const clip = await this.videoClipRepository.findOne({
      where: { id: clipId, teamId, status: VideoClipStatus.PUBLISHED },
    });
    if (!clip) {
      throw new ClipNotFoundException();
    }
    if (clip.taggedPlayerId !== requesterId) {
      throw new NotYourChallengeException();
    }

    if (clip.challengeAcknowledgedAt === null) {
      await this.videoClipRepository.update(
        { id: clipId },
        { challengeAcknowledgedAt: new Date() },
      );
    }

    return { clipId, acknowledged: true };
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
    assertTeamJoinApproved(player.teamJoinStatus);

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
