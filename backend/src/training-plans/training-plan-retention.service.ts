import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { positiveIntFromConfig } from '../error-log/error-log.util';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { RedisService } from '../redis/redis.service';
import { DEFAULT_TRAINING_PLAN_RETENTION_DAYS } from './training-plans.constants';
import { TrainingPlanDraft } from './entities/training-plan-draft.entity';

/**
 * Deletes `training_plan_draft` rows past their retention cutoff
 * (ADR-0028 Decision 7).
 *
 * Structurally identical to BugReportRetentionService and
 * ErrorLogRetentionService — same in-process cron, same Redis run-claim so
 * only one of `replicas: 2` performs the DELETE, same run-level failure
 * row so a broken sweep is visible in the admin console rather than
 * vanishing into a rejected promise. The fifth copy of this shape, and
 * copied on purpose: a sweep that behaves differently from its siblings is
 * a sweep somebody has to re-read.
 *
 * What differs is only the number. 365 days rather than the aggressive
 * windows elsewhere, because this is an adult's own work product about an
 * age band and not child data — see the constant's own comment.
 *
 * One DELETE rather than a find-then-delete loop: there is no external
 * object to remove first, so nothing keeps the rows around and there is no
 * partial-failure ordering to get right.
 */
@Injectable()
export class TrainingPlanRetentionService {
  private readonly logger = new Logger(TrainingPlanRetentionService.name);

  constructor(
    @InjectRepository(TrainingPlanDraft)
    private readonly draftRepository: Repository<TrainingPlanDraft>,
    private readonly configService: ConfigService,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredTrainingPlans(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.trainingPlanRetention;
    if (!(await this.claimRun(jobName))) {
      return;
    }

    try {
      const retentionDays = this.retentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.draftRepository.delete({
        createdAt: LessThan(cutoff),
      });
      if (result.affected) {
        this.logger.log(
          `Swept ${result.affected} training_plan_draft row(s) older than ${retentionDays} days.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to sweep expired training_plan_draft rows — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  /**
   * Parsed through `positiveIntFromConfig`, which treats empty,
   * non-numeric, zero, negative and fractional values as "use the
   * default" — the reason TRAINING_PLAN_RETENTION_DAYS must be
   * `@IsOptional()` ALONE in env.validation.ts and never stacked with
   * `@IsNotEmpty()`. An empty-but-present value is exactly what a k8s
   * Secret key with no GitHub secret behind it delivers, and stacking
   * would crash-loop the API on boot over an optional knob.
   */
  private retentionDays(): number {
    return positiveIntFromConfig(
      this.configService.get<string>('TRAINING_PLAN_RETENTION_DAYS'),
      DEFAULT_TRAINING_PLAN_RETENTION_DAYS,
    );
  }

  private claimRun(jobName: string): Promise<boolean> {
    return tryClaimScheduledJobRunOrSkip(
      this.redisService,
      this.logger,
      jobName,
    );
  }
}
