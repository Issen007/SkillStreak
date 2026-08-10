import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { RedisService } from '../redis/redis.service';
import { ErrorLogEntry } from './entities/error-log-entry.entity';
import { ERROR_LOG_JOB_NAMES } from './error-log.constants';
import { ErrorLogService } from './error-log.service';

/**
 * docs/adr/0022-admin-control-center.md Decision 6's retention sweep:
 * "deletes rows older than a config-value cutoff (recommend 90 days) —
 * bounded table growth, consistent with this app's existing retention
 * posture elsewhere".
 *
 * Structurally identical to ClipRetentionService and
 * AccountErasureSweepService, on purpose — same `@nestjs/schedule` in-process
 * cron (no new Kubernetes CronJob), same non-blocking Redis run-claim so
 * only one of k8s/api-deployment.yaml's `replicas: 2` actually runs the
 * DELETE, same "a Redis hiccup skips this tick through our own Logger rather
 * than rejecting out of the handler into the `cron` package's bare
 * console.error" discipline.
 *
 * One DELETE, not a find-then-delete loop: unlike the clip sweep there's no
 * external object (MinIO) to remove first, so there is nothing to keep the
 * rows around for and no partial-failure ordering to get right.
 */
@Injectable()
export class ErrorLogRetentionService {
  private readonly logger = new Logger(ErrorLogRetentionService.name);

  constructor(
    @InjectRepository(ErrorLogEntry)
    private readonly errorLogRepository: Repository<ErrorLogEntry>,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredErrorLogEntries(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.errorLogRetention;
    if (!(await this.claimRun(jobName))) {
      return;
    }

    try {
      const retentionDays = this.errorLogService.retentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.errorLogRepository.delete({
        occurredAt: LessThan(cutoff),
      });
      if (result.affected) {
        this.logger.log(
          `Swept ${result.affected} error_log_entry row(s) older than ${retentionDays} days.`,
        );
      }
    } catch (error) {
      // Same shape as every other job in this codebase: log it, record it
      // (Decision 6 — a failed job gets a row, rather than disappearing
      // into an unobserved rejected promise), and leave the rows for the
      // next daily run.
      this.logger.error(
        `Failed to sweep expired error_log_entry rows — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
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
