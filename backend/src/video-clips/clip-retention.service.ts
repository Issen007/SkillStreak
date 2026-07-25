import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';
import { ObjectStorageService } from './object-storage.service';
import { DEFAULT_CLIP_PENDING_UPLOAD_TTL_MINUTES } from './video-clip.constants';

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
 * Inherits this codebase's existing `replicas: 1` constraint
 * (k8s/README.md's migration-race fix) — if the API is ever scaled beyond
 * one replica, this sweep needs the same kind of single-runner guard that
 * gap already requires solving (a Postgres advisory lock, or designating
 * one replica), not a new problem invented here.
 */
@Injectable()
export class ClipRetentionService {
  private readonly logger = new Logger(ClipRetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(VideoClip)
    private readonly videoClipRepository: Repository<VideoClip>,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredPublishedClips(): Promise<void> {
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
