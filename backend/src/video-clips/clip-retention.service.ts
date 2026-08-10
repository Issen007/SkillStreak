import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { RedisService } from '../redis/redis.service';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';
import { ObjectStorageService } from './object-storage.service';
import { DEFAULT_CLIP_PENDING_UPLOAD_TTL_MINUTES } from './video-clip.constants';

// k8s/README.md's now-resolved "Scheduled-job races" note — a few minutes
// is generous headroom for either sweep (both are simple find-then-delete
// loops over a bounded row set) while staying short enough that a pod
// crashing mid-sweep doesn't wedge the *next* day's/hour's claim for long.

/**
 * docs/adr/0010-video-storage-and-serving.md Decision 5 — two in-process
 * scheduled sweeps (`@nestjs/schedule`, not a new Kubernetes CronJob),
 * sharing one mechanism parameterized by status/cutoff, per the ADR's own
 * "reuses the same mechanism... not new infrastructure" framing:
 *
 * 1. **Daily**, `published` *and* `hidden` clips past their `expires_at`
 *    (the 90-day-by-default rolling retention window, set at `complete`
 *    time). `hidden` was added 2026-08-08 — see the query's own comment.
 * 2. **Hourly**, `pending_upload` clips past a short TTL from `created_at`
 *    (~1 hour by default) — the fix for the storage-exhaustion path an
 *    abandoned/never-completed upload would otherwise leave unbounded,
 *    since the daily sweep never looks at `pending_upload` rows.
 *
 * Both delete the MinIO object *before* the Postgres row, and leave the row
 * alone (for the next run) if object deletion fails transiently — the
 * safer failure direction per the ADR: an orphaned object nobody can ever
 * reach again (no live row survives to mint a URL for it) is harmless
 * waste, while a row with no confirmed-deleted object is a live task item,
 * not a solved one.
 *
 * Now safe under 2+ replicas (k8s/api-deployment.yaml is back to
 * `replicas: 2`): each `@Cron` handler below opens by calling
 * RedisService.tryClaimScheduledJobRun for its own job name and returns
 * immediately if it loses — a non-blocking try-lock, not the blocking
 * Postgres advisory lock docker-entrypoint.sh's migration step uses (see
 * backend/src/scripts/migrate-with-lock.ts), since a replica that loses
 * this race has nothing useful left to do once the winner runs the sweep,
 * unlike a migration a losing pod still needs to eventually observe as
 * "already applied".
 *
 * Since docs/adr/0022-admin-control-center.md Decision 6, a failure of the
 * sweep as a whole (the query itself, or anything else that would otherwise
 * reject out of the `@Cron` handler unobserved) also writes an
 * `error_log_entry` row with `source: 'job'`. The per-row failures inside
 * `sweepRows` deliberately stay logger-only: they're already observed, and
 * a sustained MinIO outage would otherwise write one row per clip per run
 * into a table the admin console paginates over — the run-level row is what
 * tells an operator this sweep is unhealthy.
 */
@Injectable()
export class ClipRetentionService {
  private readonly logger = new Logger(ClipRetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
    private readonly objectStorageService: ObjectStorageService,
    private readonly redisService: RedisService,
    private readonly errorLogService: ErrorLogService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredPublishedClips(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.clipRetentionPublished;
    if (!(await this.claimRun(jobName))) {
      return;
    }
    try {
      const rows = await this.videoClipRepository.find({
        where: {
          // `hidden` is swept on exactly the same clock as `published`
          // (fixed 2026-08-08, BACKLOG.md). This used to be PUBLISHED
          // alone, which meant a clip a teammate had reported —
          // VideoClipsService.reportClip flips it to HIDDEN — fell out of
          // retention entirely and kept both its row and its MinIO object
          // forever. That inverted the intent: the reported clips are the
          // last set that should outlive the window, and
          // docs/legal/terms-of-service-DRAFT.md promises every clip is
          // "automatically and permanently deleted after a limited
          // period".
          status: In([VideoClipStatus.PUBLISHED, VideoClipStatus.HIDDEN]),
          expiresAt: LessThan(new Date()),
        },
      });
      await this.sweepRows(rows, 'expired published or hidden clip');
    } catch (error) {
      await this.recordJobFailure(jobName, error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepAbandonedPendingUploads(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.clipRetentionPendingUpload;
    if (!(await this.claimRun(jobName))) {
      return;
    }
    try {
      const ttlMinutes = this.pendingUploadTtlMinutes();
      const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
      const rows = await this.videoClipRepository.find({
        where: {
          status: VideoClipStatus.PENDING_UPLOAD,
          createdAt: LessThan(cutoff),
        },
      });
      await this.sweepRows(rows, 'abandoned pending_upload clip');
    } catch (error) {
      await this.recordJobFailure(jobName, error);
    }
  }

  /**
   * docs/adr/0022-admin-control-center.md Decision 6 — a run-level failure
   * gets a durable row instead of disappearing into an unobserved rejected
   * promise. Logged as well as recorded: stdout is still the first place an
   * operator looks, and it's the only place left if the recorder's own
   * database write is what's broken (ErrorLogService.record swallows that).
   */
  private async recordJobFailure(
    jobName: string,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      `${jobName} failed — left for the next run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await this.errorLogService.record({ source: 'job', jobName, error });
  }

  private pendingUploadTtlMinutes(): number {
    const raw = this.configService.get<string>(
      'CLIP_PENDING_UPLOAD_TTL_MINUTES',
    );
    return raw ? Number(raw) : DEFAULT_CLIP_PENDING_UPLOAD_TTL_MINUTES;
  }

  private async sweepRows(rows: VideoClip[], label: string): Promise<void> {
    if (rows.length === 0) return;
    this.logger.log(`Sweeping ${rows.length} ${label}(s).`);
    for (const row of rows) {
      try {
        // Delete-if-exists (ADR-0010): most abandoned pending_upload rows
        // never got any bytes at all, so this is usually just the row
        // delete below.
        await this.objectStorageService.deleteObjectIfExists(row.storageKey);
        await this.videoClipRepository.delete({ id: row.id });
      } catch (error) {
        this.logger.warn(
          `Failed to sweep ${label} ${row.id} — left for the next run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Shared across every scheduled job — see the util's docstring. */
  private claimRun(jobName: string): Promise<boolean> {
    return tryClaimScheduledJobRunOrSkip(
      this.redisService,
      this.logger,
      jobName,
    );
  }
}
