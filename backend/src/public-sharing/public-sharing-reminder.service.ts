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
      // **Checked before the early return, and keyed on how many consents
      // exist rather than how many are due today** (security review
      // 2026-08-19, finding 7). It used to sit after `due.length === 0`,
      // so on a small beta the "we are running blind" alarm only fired on
      // the handful of days a month when a reminder happened to fall due
      // — close to the silence the ADR objected to. Supervision being
      // absent is a standing condition, not a per-send event.
      // Hoisted out of the bounce-detection branch below, because the
      // heartbeat at the end of this method needs it too: an empty sweep
      // against 0 consents and against 40 are different facts, and one
      // count answers both questions.
      const supervised = await this.consentService.countActive();

      if (!this.bounceMailboxService.isConfigured()) {
        if (supervised === 0) {
          // Nothing is at risk yet — no consent exists to go unsupervised
          // — so this is a note, not an incident. **Deliberately not an
          // error-log row** (security review 2026-08-19, second pass):
          // today, with the allow-list empty, that would write one row a
          // day forever saying nothing is wrong, and the error log is the
          // only channel that reports this gap. Teaching the operator to
          // scroll past it is how the channel stops working on the day it
          // finally matters.
          this.logger.warn(
            'Public-sharing reminders have no bounce detection configured. ' +
              'No active consents yet, so nothing is unsupervised — but ' +
              'set BOUNCE_IMAP_HOST/USER/PASSWORD before enabling a team.',
          );
        } else {
          this.logger.error(
            `Public-sharing reminders are running with NO bounce detection ` +
              `configured — an undeliverable reminder cannot be observed, so ` +
              `ADR-0030 Decision 5 cannot disable a consent behind a dead ` +
              `parent address. ${supervised} active consent(s) are ` +
              `unsupervised. Set BOUNCE_IMAP_HOST/USER/PASSWORD.`,
          );
          await this.errorLogService.record({
            source: 'job',
            jobName,
            error: new Error(
              `public-sharing reminders are running without bounce ` +
                `detection; ${supervised} active consent(s) are unsupervised`,
            ),
          });
        }
      }

      if (due.length === 0) {
        /*
         * A heartbeat, including on the days there is nothing to do.
         *
         * This sweep used to return silently here, which made a healthy
         * quiet day and a scheduler that never ran indistinguishable —
         * both produced no log line at all. That is a bad property for
         * *this* job in particular: it is ADR-0030 Decision 5's only
         * recurring control, so if the cron silently stopped registering,
         * or every replica kept losing the lock, parents would quietly
         * stop being reminded that sharing is on and the auto-disable
         * behind a dead address would never fire. Nobody would find out,
         * because nothing would look wrong.
         *
         * Checked 2026-08-23: nothing from this service had appeared in
         * 48 hours of production logs, and there was no way to tell
         * whether that meant "working" or "dead".
         *
         * One line a day, and it says how many families are under the
         * control rather than just that the job woke up — an empty sweep
         * against 0 consents and against 40 are different facts.
         */
        this.logger.log(
          `Public-sharing reminders: none due today (${supervised} active ` +
            `consent(s) under monthly reminder).`,
        );
        return;
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
