import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';
import { ObjectStorageService } from './object-storage.service';
import { DEFAULT_CLIP_PENDING_UPLOAD_TTL_MINUTES } from './video-clip.constants';

// k8s/README.md's now-resolved "Scheduled-job races" note — a few minutes
// is generous headroom for either sweep (both are simple find-then-delete
// loops over a bounded row set) while staying short enough that a pod
// crashing mid-sweep doesn't wedge the *next* day's/hour's claim for long.
const SCHEDULED_JOB_LOCK_TTL_SECONDS = 5 * 60;

/**
 * docs/adr/0010-video-storage-and-serving.md Decision 5 — two in-process
 * scheduled sweeps (`@nestjs/schedule`, not a new Kubernetes CronJob),
 * sharing one mechanism parameterized by status/cutoff, per the ADR's own
 * "reuses the same mechanism... not new infrastructure" framing:
 *
 * 1. **Daily**, `published` clips past their `expires_at` (the 90-day-by-
 *    default rolling retention window, set at `complete` time).
 * 2. **Hourly**, `pending_upload` clips past a short TTL from `created_at`
 *    (~1 hour by default) — the fix for the storage-exhaustion path an
 *    abandoned/never-completed upload would otherwise leave unbounded,
 *    since the daily sweep only ever looks at `published` rows.
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
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredPublishedClips(): Promise<void> {
    if (!(await this.tryClaimJobOrSkip('clip-retention:published'))) {
      return;
    }
    const rows = await this.videoClipRepository.find({
      where: {
        status: VideoClipStatus.PUBLISHED,
        expiresAt: LessThan(new Date()),
      },
    });
    await this.sweepRows(rows, 'expired published clip');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepAbandonedPendingUploads(): Promise<void> {
    if (!(await this.tryClaimJobOrSkip('clip-retention:pending-upload'))) {
      return;
    }
    const ttlMinutes = this.pendingUploadTtlMinutes();
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    const rows = await this.videoClipRepository.find({
      where: {
        status: VideoClipStatus.PENDING_UPLOAD,
        createdAt: LessThan(cutoff),
      },
    });
    await this.sweepRows(rows, 'abandoned pending_upload clip');
  }

  /**
   * code-critic's review of the replicas:2 fix caught this: with no
   * try/catch here, a Redis hiccup would reject out of the `@Cron` handler
   * uncaught — `@nestjs/schedule`'s underlying `cron` package does catch
   * that (the process doesn't crash), but only via a raw `console.error`,
   * not this app's own `Logger`, making a real Redis-connectivity problem
   * here quietly less visible than every other degraded-but-non-fatal
   * failure path in this codebase. Treated the same as "another replica
   * already claimed this run" either way — skip this tick, don't crash a
   * whole sweep over a transient lock-check failure — but now logged
   * through `this.logger.warn` so it shows up like everything else.
   */
  private async tryClaimJobOrSkip(jobName: string): Promise<boolean> {
    try {
      const claimed = await this.redisService.tryClaimScheduledJobRun(
        jobName,
        SCHEDULED_JOB_LOCK_TTL_SECONDS,
      );
      if (!claimed) {
        this.logger.debug(
          `Skipping ${jobName} — another replica already claimed this run.`,
        );
      }
      return claimed;
    } catch (error) {
      this.logger.warn(
        `Skipping ${jobName} this tick — failed to check the Redis run-lock: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
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
}
