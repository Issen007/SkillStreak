import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  ERROR_LOG_JOB_LOCK_TTL_SECONDS,
  ERROR_LOG_JOB_NAMES,
} from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { positiveIntFromConfig } from '../error-log/error-log.util';
import { RedisService } from '../redis/redis.service';
import { DEFAULT_BUG_REPORT_RETENTION_DAYS } from './bug-reports.constants';
import { BugReport } from './entities/bug-report.entity';

/**
 * Deletes `bug_report` rows past their retention cutoff.
 *
 * Added 2026-08-09 from a security-reviewer observation on the Phase 7
 * work: this was the only table in the app holding **child-authored free
 * text** with no retention bound, while clips (ADR-0010 Decision 5) and
 * `error_log_entry` (ADR-0022 Decision 6) both have one. An account erasure
 * already removes a departing player's reports via `ON DELETE CASCADE`, but
 * that only covers players who leave — a report from a child who stays was
 * kept indefinitely, which contradicts the retention posture this app
 * states everywhere else.
 *
 * Structurally identical to ErrorLogRetentionService, deliberately: same
 * in-process `@nestjs/schedule` cron rather than a new Kubernetes CronJob,
 * same non-blocking Redis run-claim so only one of `replicas: 2` runs the
 * DELETE, same "a Redis hiccup skips this tick through our own Logger"
 * discipline, and the same run-level failure row so a broken sweep is
 * visible in the admin console rather than vanishing into a rejected
 * promise.
 *
 * One DELETE, not a find-then-delete loop: like the error log and unlike
 * the clip sweep, there is no external object to remove first, so there is
 * nothing to keep the rows around for and no partial-failure ordering to
 * get right.
 *
 * See DEFAULT_BUG_REPORT_RETENTION_DAYS for why this sweeps by age alone
 * rather than only touching `closed` reports.
 */
@Injectable()
export class BugReportRetentionService {
  private readonly logger = new Logger(BugReportRetentionService.name);

  constructor(
    @InjectRepository(BugReport)
    private readonly bugReportRepository: Repository<BugReport>,
    private readonly configService: ConfigService,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredBugReports(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.bugReportRetention;
    if (!(await this.tryClaimJobOrSkip(jobName))) {
      return;
    }

    try {
      const retentionDays = this.retentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.bugReportRepository.delete({
        createdAt: LessThan(cutoff),
      });
      if (result.affected) {
        this.logger.log(
          `Swept ${result.affected} bug_report row(s) older than ${retentionDays} days.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to sweep expired bug_report rows — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  /**
   * Parsed through the same `positiveIntFromConfig` the error-log knobs use,
   * which treats an empty, non-numeric, zero, negative or fractional value
   * as "use the default" — the reason BUG_REPORT_RETENTION_DAYS is
   * `@IsOptional()` **alone** in env.validation.ts rather than stacked with
   * `@IsNotEmpty()`. An empty-but-present value is what a k8s Secret key
   * with no GitHub Actions secret behind it, or docker-compose's
   * `${VAR:-}`, actually delivers, and stacking would crash-loop the API on
   * boot over an optional operational knob.
   */
  private retentionDays(): number {
    return positiveIntFromConfig(
      this.configService.get<string>('BUG_REPORT_RETENTION_DAYS'),
      DEFAULT_BUG_REPORT_RETENTION_DAYS,
    );
  }

  /**
   * Identical to ErrorLogRetentionService/ClipRetentionService/
   * AccountErasureSweepService/UsageMetricsReportService's own helper — see
   * ClipRetentionService's docstring for why a lost claim and a failed lock
   * check are both just "skip this tick". (Five copies is now past the
   * point where one shared `runScheduledJob` helper would be better; noted
   * rather than done here, since collapsing it touches four already-shipped
   * services and belongs in its own change.)
   */
  private async tryClaimJobOrSkip(jobName: string): Promise<boolean> {
    try {
      const claimed = await this.redisService.tryClaimScheduledJobRun(
        jobName,
        ERROR_LOG_JOB_LOCK_TTL_SECONDS,
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
}
