import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImapFlow } from 'imapflow';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { parseDsn } from '../mail/dsn.parser';
import { RedisService } from '../redis/redis.service';
import { PublicSharingConsentService } from './public-sharing-consent.service';

/**
 * ADR-0030 finding 4 — the bounce mailbox, polled and parsed for DSNs.
 *
 * ## What this closes
 *
 * Decision 5 disables a public-sharing consent after two consecutive
 * undeliverable monthly reminders, because an unreachable parent on an
 * account whose media can leave its team means the supervision the whole
 * design rests on has stopped. It could not fire, because nothing here
 * could observe the failure it was written for: a relay accepts a message
 * for a dead mailbox on a live domain and bounces it *later*, to the
 * envelope sender, out of band. The sending process sees a clean handoff
 * and returns.
 *
 * This service is the missing half. Mail sent to the configured address
 * lands in a real mailbox; every poll reads what arrived, parses the
 * delivery reports, and hands each permanent failure to
 * `recordReminderUndeliverable`.
 *
 * ## Attribution is by token only, deliberately
 *
 * Each reminder carries a random per-send token, both as an
 * `X-SkillStreak-Consent` header and inside its `Message-ID`. A DSN
 * returns the original's headers, so the token comes back with it.
 *
 * **Matching on the recipient address instead was considered and is not
 * done.** It would attribute more bounces — some MTAs return no original
 * headers at all — but it cannot say *which* consent: siblings on the
 * same team share one parent address, and `recipient_contact_snapshot` is
 * encrypted with a random IV, so matching would mean decrypting candidate
 * rows and comparing. Acting on an ambiguous match revokes a consent a
 * parent granted, on evidence that does not identify the family. The
 * unattributed count is logged on every run instead, so how often that
 * actually happens becomes a measurement rather than a guess — and if it
 * turns out to be common, that is the number that should justify building
 * the fallback.
 *
 * ## The mailbox holds credentials
 *
 * A DSN quotes the message that failed, and a reminder contains the
 * parent's revoke link. So this mailbox accumulates live revoke codes,
 * and is treated accordingly: messages are deleted once read, nothing
 * from the body is logged or persisted, and the account should exist only
 * for this purpose. The exposure is bounded by direction — a revoke code
 * only ever turns sharing *off*, which is the safe way for this
 * particular secret to leak — but "bounded" is not "fine".
 */
/**
 * A delivery report is a small message. Anything larger is not one, and
 * reading it into memory is free denial of service for anyone who knows
 * the bounce address. 256 KiB is generous for a DSN quoting an original.
 */
const MAX_MESSAGE_BYTES = 256 * 1024;

/** Per-run ceiling, so one flood cannot make an hourly job unbounded. */
const MAX_MESSAGES_PER_RUN = 200;

@Injectable()
export class BounceMailboxService {
  private readonly logger = new Logger(BounceMailboxService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly consentService: PublicSharingConsentService,
    private readonly errorLogService: ErrorLogService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Whether bounce detection is actually available.
   *
   * The reminder sweep reads this and says so loudly when it is false —
   * see `public-sharing-reminder.service.ts`. The ADR's warning was that
   * a sweep built on handoff-only signalling "would report healthy while
   * the case it exists to catch went undetected", and an unconfigured
   * mailbox puts the system back in exactly that state. It must be
   * visible rather than assumed.
   */
  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('BOUNCE_IMAP_HOST') &&
      this.configService.get<string>('BOUNCE_IMAP_USER') &&
      this.configService.get<string>('BOUNCE_IMAP_PASSWORD'),
    );
  }

  /**
   * Hourly rather than daily.
   *
   * A bounce is the input to a control that disables a live consent, and
   * the reminder interval is a month — so an hour of latency is nothing,
   * while a day of it means a poll that fails silently goes a full day
   * unnoticed. Hourly also keeps each run's message count small enough
   * that one bad message cannot starve the rest.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async pollBounceMailbox(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.publicSharingBounceIntake;
    if (!this.isConfigured()) {
      // Debug, not warn: the *reminder* job is the one that reports this
      // as a supervision gap, once per run, with the consent count it
      // affects. Repeating it hourly here would bury that.
      this.logger.debug(
        'Bounce mailbox not configured — skipping. Set BOUNCE_IMAP_HOST/USER/PASSWORD.',
      );
      return;
    }
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
      const summary = await this.drainMailbox();
      if (summary.messages > 0) {
        this.logger.log(
          `Bounce intake: ${summary.messages} message(s), ` +
            `${summary.dsns} delivery report(s), ` +
            `${summary.permanent} permanent failure(s), ` +
            `${summary.attributed} attributed, ` +
            `${summary.unattributed} unattributed, ` +
            `${summary.skipped} skipped, ` +
            `${summary.disabled} consent(s) disabled.`,
        );
      }
    } catch (error) {
      // Same shape as every other scheduled job here: log it, record it
      // so it surfaces in the admin console, and leave the messages in
      // the mailbox for the next run. Nothing is deleted on a failed
      // pass, so a transient IMAP problem costs latency, not evidence.
      this.logger.error(
        `Bounce mailbox poll failed — messages left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  private async drainMailbox(): Promise<{
    messages: number;
    dsns: number;
    permanent: number;
    attributed: number;
    unattributed: number;
    disabled: number;
    skipped: number;
  }> {
    const summary = {
      messages: 0,
      dsns: 0,
      permanent: 0,
      attributed: 0,
      unattributed: 0,
      disabled: 0,
      skipped: 0,
    };

    const client = new ImapFlow({
      host: this.configService.getOrThrow<string>('BOUNCE_IMAP_HOST'),
      port: Number(this.configService.get<string>('BOUNCE_IMAP_PORT') ?? '993'),
      // Implicit TLS on 993. Unlike the SMTP side (587 + STARTTLS), IMAP
      // here is a straight TLS socket, and this is a password-authenticated
      // mailbox holding revoke codes — there is no plaintext mode worth
      // offering as a fallback.
      secure:
        (this.configService.get<string>('BOUNCE_IMAP_SECURE') ?? 'true') !==
        'false',
      auth: {
        user: this.configService.getOrThrow<string>('BOUNCE_IMAP_USER'),
        pass: this.configService.getOrThrow<string>('BOUNCE_IMAP_PASSWORD'),
      },
      // ImapFlow's own logger is extremely chatty and prints message
      // envelopes — which for this mailbox means recipient addresses.
      logger: false,
    });

    await client.connect();
    try {
      const mailbox =
        this.configService.get<string>('BOUNCE_IMAP_MAILBOX') ?? 'INBOX';
      const lock = await client.getMailboxLock(mailbox);
      try {
        // **Every IMAP command is issued outside the fetch generator, and
        // that is not a style choice.**
        //
        // The obvious shape — `for await (const m of client.fetch(...))`
        // with a `messageDelete` in the body — deadlocks. imapflow's
        // reader awaits `handleResponse`, which awaits the untagged FETCH
        // handler, which awaits the consumer callback; so while the loop
        // body runs, no server response is read at all, including the
        // tagged OK that a newly queued command needs in order to
        // proceed. The delete therefore never dispatches, the client
        // blocks for the whole 5-minute socket timeout and throws
        // NoConnection.
        //
        // Reproduced against a real socket: the "delete inside the loop"
        // shape sent `UID FETCH` and then nothing — no STORE, no EXPUNGE
        // — while the "act afterwards" shape completed in 42ms. The
        // consequence was one message processed per run, nothing ever
        // deleted, and the same message re-read every hour forever, while
        // `isConfigured()` reported the mailbox healthy and silenced the
        // reminder sweep's "unsupervised" alarm. (Security review
        // 2026-08-19, blocking finding 1.)
        //
        // Resolving the UIDs up front and fetching each one on its own
        // keeps per-message durability — a message is deleted the moment
        // it is handled, not batched at the end where one throw discards
        // the lot — without ever holding the generator open.
        //
        // `{ seen: false }` skips anything a previous run flagged after
        // failing to process it. imapflow fetches with `BODY.PEEK`, so
        // nothing sets `\Seen` on its own; the flag on the failure path
        // below is what makes this filter mean anything, and what stops a
        // poisonous message being retried forever.
        // `search` returns `false` rather than an empty array when the
        // server declines, so normalise before touching it.
        const found = await client.search({ seen: false }, { uid: true });
        const uids: number[] = Array.isArray(found) ? found : [];
        const batch = uids.slice(0, MAX_MESSAGES_PER_RUN);
        if (uids.length > batch.length) {
          this.logger.warn(
            `Bounce intake: ${uids.length} unread message(s), handling ` +
              `${batch.length} this run; the rest follow next poll.`,
          );
        }

        for (const uid of batch) {
          // Bounded fetch. A delivery report is small; anything larger is
          // not one, and reading it whole is free denial of service for
          // anyone who knows the bounce address — which is the envelope
          // sender of every reminder, so every parent does.
          const message = await client.fetchOne(
            String(uid),
            { source: { maxLength: MAX_MESSAGE_BYTES } },
            { uid: true },
          );
          if (!message) continue;
          summary.messages += 1;
          const raw = message.source?.toString('utf8') ?? '';

          try {
            const outcome = await this.processMessage(raw);
            if (outcome.dsn) summary.dsns += 1;
            summary.permanent += outcome.permanent;
            summary.attributed += outcome.attributed;
            summary.unattributed += outcome.unattributed;
            summary.disabled += outcome.disabled;

            // Deleted immediately, not batched: these quote reminder
            // bodies, which carry live revoke links.
            const deleted = await client.messageDelete([uid], { uid: true });
            if (!deleted) {
              // imapflow returns false rather than throwing. Said out
              // loud because an undeleted message is a live revoke code
              // left sitting in a mailbox.
              this.logger.warn(
                `Bounce intake: could not delete message uid ${uid}; it ` +
                  'quotes a reminder and should be removed by hand.',
              );
            }
          } catch (error) {
            // One malformed or hostile message must not stop the drain,
            // and must not be retried forever either.
            this.logger.warn(
              `Skipping one bounce-mailbox message that failed to process: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            summary.skipped += 1;
            // Flagged so the next run's `seen: false` filter skips it;
            // left undeleted so a human can still look at it. A failure
            // to flag is reported rather than swallowed — silently
            // failing here recreates the retry-forever loop, and a
            // read-only mailbox or a server that refuses the STORE
            // produces it without any deadlock involved.
            const flagged = await client
              .messageFlagsAdd([uid], ['\\Seen'], { uid: true })
              .catch(() => false);
            if (!flagged) {
              this.logger.error(
                `Bounce intake: could not flag unprocessable message uid ` +
                  `${uid} as seen — it will be retried on every poll and ` +
                  'may block the mailbox draining. Remove it by hand.',
              );
            }
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      // `logout()` can itself throw on an already-broken socket; the
      // close is best-effort because the work is already done and
      // committed by this point.
      await client.logout().catch(() => client.close());
    }

    return summary;
  }

  /**
   * Parses one raw message and applies whatever it proves.
   *
   * Note what is NOT logged: no address, no diagnostic text, no message
   * body. A bounce identifies a parent's email and, by implication, a
   * specific child — this app's logs are not a place for either. The
   * consent id in `recordReminderUndeliverable`'s own warning is enough to
   * investigate with.
   */
  private async processMessage(raw: string): Promise<{
    dsn: boolean;
    permanent: number;
    attributed: number;
    unattributed: number;
    disabled: number;
  }> {
    const report = parseDsn(raw);
    if (!report.isDsn) {
      // Autoresponders, spam, and humans replying to a no-reply address.
      // Read, counted, deleted, and never treated as a delivery failure.
      return {
        dsn: false,
        permanent: 0,
        attributed: 0,
        unattributed: 0,
        disabled: 0,
      };
    }

    const permanentFailures = report.recipients.filter((r) => r.permanent);
    if (permanentFailures.length === 0) {
      // A delayed notice, or a delivery receipt. Explicitly not a
      // failure — see the parser's own tests for why a 4.x.x must never
      // reach the counter.
      return {
        dsn: true,
        permanent: 0,
        attributed: 0,
        unattributed: 0,
        disabled: 0,
      };
    }

    if (!report.originalToken) {
      this.logger.warn(
        `Bounce mailbox: ${permanentFailures.length} permanent failure(s) ` +
          'in a DSN carrying no correlation token — cannot attribute to a ' +
          'consent. If this is common, the sending MTA is not returning ' +
          'original headers (ADR-0030 finding 4, residual).',
      );
      return {
        dsn: true,
        permanent: permanentFailures.length,
        attributed: 0,
        unattributed: permanentFailures.length,
        disabled: 0,
      };
    }

    const result = await this.consentService.recordReminderUndeliverable(
      report.originalToken,
    );

    if (!result.matched) {
      // A token we minted but no longer hold: the reminder was superseded
      // by a newer one, or the consent row is gone (account erased). Both
      // are ordinary, and neither is actionable.
      this.logger.debug(
        'Bounce mailbox: DSN carried a token matching no current reminder.',
      );
      return {
        dsn: true,
        permanent: permanentFailures.length,
        attributed: 0,
        unattributed: permanentFailures.length,
        disabled: 0,
      };
    }

    return {
      dsn: true,
      permanent: permanentFailures.length,
      attributed: 1,
      unattributed: 0,
      disabled: result.disabled ? 1 : 0,
    };
  }
}
