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
import { EventRegistration } from './entities/event-registration.entity';
import { DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS } from './event-registrations.constants';

/**
 * Deletes `event_registration` rows past their retention cutoff.
 *
 * Why this exists at all, when the admin console already has a delete
 * button: the button honours a request ("take me off the list"), and this
 * honours the promise made when the row was written. The form says the
 * details are used only to invite someone to a demo. Once that demo is a
 * year gone, keeping the address is holding personal data for a purpose
 * nobody consented to — and a policy enforced only by someone remembering
 * to click is not a retention policy, it is an intention.
 *
 * Structurally identical to BugReportRetentionService and
 * ErrorLogRetentionService: in-process `@nestjs/schedule` cron rather than
 * a Kubernetes CronJob, a non-blocking Redis run-claim so only one of
 * `replicas: 2` runs the DELETE, "a Redis hiccup skips this tick" rather
 * than throwing, and a run-level failure row so a broken sweep shows up in
 * the admin console instead of vanishing into a rejected promise.
 *
 * One DELETE, not find-then-delete: there is no external object (no S3
 * key, no media) to remove first, so there is no partial-failure ordering
 * to get right.
 *
 * **Swept by age alone, never by campaign or interest.** A rule like
 * "keep the investors longer" would quietly turn a uniform retention
 * promise into a per-person one based on what someone picked in a
 * dropdown, and the form never said that.
 */
@Injectable()
export class EventRegistrationRetentionService {
  private readonly logger = new Logger(EventRegistrationRetentionService.name);

  constructor(
    @InjectRepository(EventRegistration)
    private readonly registrations: Repository<EventRegistration>,
    private readonly configService: ConfigService,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepExpiredRegistrations(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.eventRegistrationRetention;
    if (!(await this.claimRun(jobName))) {
      return;
    }

    try {
      const retentionDays = this.retentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.registrations.delete({
        createdAt: LessThan(cutoff),
      });
      if (result.affected) {
        this.logger.log(
          `Swept ${result.affected} event_registration row(s) older than ${retentionDays} days.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to sweep expired event_registration rows — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  /**
   * `@IsOptional()` alone in env.validation.ts, parsed here through the
   * same `positiveIntFromConfig` every other retention knob uses — it
   * treats empty, non-numeric, zero, negative and fractional values as
   * "use the default", which is what stops an empty-but-present env var
   * (a k8s Secret key with nothing behind it, or compose's `${VAR:-}`)
   * from crash-looping the API on boot over an operational knob.
   */
  private retentionDays(): number {
    return positiveIntFromConfig(
      this.configService.get<string>('EVENT_REGISTRATION_RETENTION_DAYS'),
      DEFAULT_EVENT_REGISTRATION_RETENTION_DAYS,
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
