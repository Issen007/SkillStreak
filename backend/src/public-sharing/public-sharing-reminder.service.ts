import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { RedisService } from '../redis/redis.service';
import { BounceMailboxService } from './bounce-mailbox.service';
import { PublicSharingConsentService } from './public-sharing-consent.service';

/**
 * ADR-0030 Decision 6's monthly reminder.
 *
 * **This job was deliberately not written until 2026-08-19**, and the
 * reason is worth keeping at the top of the file it eventually became.
 * The ADR's finding 4 said it plainly: a sweep built on handoff-only
 * signalling "would report healthy while the case it exists to catch
 * went undetected". Sending mail and calling a clean SMTP handoff a
 * delivered reminder would have produced a job that ran green forever
 * while consents sat live behind dead parent addresses — worse than no
 * job, because it would have looked like supervision.
 *
 * It exists now because `BounceMailboxService` gives it a real delivery
 * signal to fail on.
 *
 * ## Under the amended Decision 3 this is the only recurring control
 *
 * There is no second gate. If this stops running, Decision 5's
 * fail-closed disable stops with it and consents that should have lapsed
 * stay live — which is why a failure here is recorded to the error log
 * rather than only logged, and why the degraded case below is loud.
 */
@Injectable()
export class PublicSharingReminderService {
  private readonly logger = new Logger(PublicSharingReminderService.name);

  constructor(
    private readonly consentService: PublicSharingConsentService,
    private readonly bounceMailboxService: BounceMailboxService,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Daily, though each consent is only reminded monthly.
   *
   * The cadence is per-consent (Decision 6: a month after *that* family's
   * grant, not the 1st for everybody), so the job has to look every day
   * to find whoever came due today. `findDueReminders` is what enforces
   * the month.
   */
  @Cron(CronExpression.EVERY_DAY_AT_NOON)
  async sendDueReminders(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.publicSharingReminder;
    if (
      !(await tryClaimScheduledJobRunOrSkip(
        this.redisService,
        this.logger,
        jobName,
      ))
    ) {
      return;
    }

    try {
      const due = await this.consentService.findDueReminders();
      if (due.length === 0) return;

      // **The degraded case, made loud on purpose.**
      //
      // Reminders still go out — the parent-facing half of Decision 6 is
      // real value on its own, and the revoke link inside is a parent's
      // only standing lever, so withholding them would remove a control
      // rather than add one. What must not happen is this running
      // quietly: with no bounce mailbox, a dead address is invisible
      // again and Decision 5's disable cannot fire. So it is recorded as
      // a job failure every run, with the number of consents affected,
      // and shows up in the admin console beside real breakage.
      if (!this.bounceMailboxService.isConfigured()) {
        this.logger.error(
          `Sending ${due.length} public-sharing reminder(s) with NO bounce ` +
            'detection configured — an undeliverable reminder cannot be ' +
            'observed, so ADR-0030 Decision 5 cannot disable a consent ' +
            'behind a dead parent address. Set BOUNCE_IMAP_HOST/USER/' +
            'PASSWORD.',
        );
        await this.errorLogService.record({
          source: 'job',
          jobName,
          error: new Error(
            `public-sharing reminders are running without bounce detection; ` +
              `${due.length} active consent(s) are unsupervised`,
          ),
        });
      }

      let sent = 0;
      let disabled = 0;
      for (const row of due) {
        try {
          const result = await this.consentService.sendReminder(row);
          if (result.sent) sent += 1;
          if (result.disabled) disabled += 1;
        } catch (error) {
          // One family's bad row must not stop everyone else's reminder.
          // Nothing is retried within the run: the next daily tick will
          // find this consent still due and try again, which is the same
          // idempotent-periodic-job posture every other sweep here takes.
          this.logger.warn(
            `Failed to send public-sharing reminder for consent ${row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      this.logger.log(
        `Public-sharing reminders: ${sent}/${due.length} sent, ` +
          `${disabled} consent(s) disabled as undeliverable.`,
      );
    } catch (error) {
      this.logger.error(
        `Public-sharing reminder sweep failed — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }
}
