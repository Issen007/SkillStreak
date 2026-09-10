import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { positiveIntFromConfig } from '../error-log/error-log.util';
import { RedisService } from '../redis/redis.service';
import { DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS } from './improvement-suggestions.constants';
import { ImprovementSuggestion } from './entities/improvement-suggestion.entity';

/**
 * Deletes `improvement_suggestion` rows past their retention cutoff.
 *
 * Structurally identical to BugReportRetentionService, deliberately: same
 * in-process `@nestjs/schedule` cron rather than a new Kubernetes CronJob,
 * same non-blocking Redis run-claim so only one of `replicas: 2` runs the
 * DELETE, and the same run-level failure row so a broken sweep is visible
 * in the admin console rather than vanishing into a rejected promise.
 *
 * This table holds child-authored free text, and it shipped with a
 * retention bound on day one rather than acquiring one later after a
 * security review noticed — which is what happened to `bug_report`
 * (2026-08-09). See DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS for why
 * it sweeps by age alone, and for what "keeping" a good suggestion
 * actually means.
 */
@Injectable()
export class ImprovementSuggestionRetentionService {
  private readonly logger = new Logger(
    ImprovementSuggestionRetentionService.name,
  );

  constructor(
    @InjectRepository(ImprovementSuggestion)
    private readonly improvementSuggestionRepository: Repository<ImprovementSuggestion>,
    private readonly configService: ConfigService,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredImprovementSuggestions(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.improvementSuggestionRetention;
    if (!(await this.claimRun(jobName))) {
      return;
    }

    try {
      const retentionDays = this.retentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.improvementSuggestionRepository.delete({
        createdAt: LessThan(cutoff),
      });
      if (result.affected) {
        this.logger.log(
          `Swept ${result.affected} improvement_suggestion row(s) older than ${retentionDays} days.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to sweep expired improvement_suggestion rows — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  /**
   * Parsed through the same `positiveIntFromConfig` every other retention
   * knob uses, which treats an empty, non-numeric, zero, negative or
   * fractional value as "use the default" — the reason
   * IMPROVEMENT_SUGGESTION_RETENTION_DAYS is `@IsOptional()` **alone** in
   * env.validation.ts rather than stacked with `@IsNotEmpty()`. An
   * empty-but-present value is what a k8s Secret key with no GitHub
   * Actions secret behind it, or docker-compose's `${VAR:-}`, actually
   * delivers, and stacking would crash-loop the API on boot over an
   * optional operational knob.
   */
  private retentionDays(): number {
    return positiveIntFromConfig(
      this.configService.get<string>('IMPROVEMENT_SUGGESTION_RETENTION_DAYS'),
      DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS,
    );
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
