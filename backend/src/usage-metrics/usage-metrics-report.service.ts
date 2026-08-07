import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { MailService } from '../mail/mail.service';
import { buildUsageReportEmail } from '../mail/templates/usage-report-email.template';
import { RedisService } from '../redis/redis.service';
import {
  USAGE_REPORT_JOB_LOCK_TTL_SECONDS,
  USAGE_REPORT_JOB_NAME,
} from './usage-metrics.constants';
import { UsageMetricsService } from './usage-metrics.service';
import { formatUsageReportSections } from './usage-report-sections';
import { resolveUsageReportCron } from './usage-report-cron.util';

// Evaluated once, at import time — see resolveUsageReportCron's docstring
// for why the cadence has to be read from process.env here rather than
// through ConfigService, and why a malformed value degrades to the monthly
// default instead of crashing boot.
const CRON_DECISION = resolveUsageReportCron();

// k8s/secret.yaml.example's fill-me-in marker, shared by every key in that
// file. See recipient() for why this specific string has to be rejected.
const SECRET_TEMPLATE_PLACEHOLDER = 'CHANGE_ME';

// One address only: no comma/semicolon/whitespace anywhere, one `@`, and a
// dotted domain. See recipient() for why this is deliberately coarse.
const SINGLE_EMAIL_ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * docs/adr/0020-usage-analytics-product-metrics.md Decision 5 — the whole
 * delivery mechanism: an in-process `@nestjs/schedule` job inside the
 * existing API that computes Decision 1's metrics and emails them to the
 * project owner through the existing MailService/SMTP relay. No new
 * endpoint, no admin-authentication system (deliberately not rebuilt after
 * Phase 2's pivot removed the adult-login concept), no new Kubernetes
 * primitive, no new network path — the job runs where the data already
 * lives and where outbound email already works.
 *
 * Multi-replica safe in exactly the way ClipRetentionService and
 * AccountErasureSweepService already are (k8s/api-deployment.yaml runs
 * `replicas: 2`): the handler opens with a non-blocking Redis try-lock
 * (RedisService.tryClaimScheduledJobRun) and returns immediately if another
 * replica already claimed this run. Without it, every replica would compute
 * and send its own copy of the same monthly report.
 *
 * Two graceful-degradation paths, both deliberate and both silent-by-log
 * rather than throwing — a reporting job must never take the API down:
 *
 * - USAGE_REPORT_RECIPIENT_EMAIL unset -> no-op with a log line, the same
 *   posture MailService itself already takes when SMTP is unconfigured. The
 *   value is genuinely optional: it's a Secret key the project owner may
 *   not have set yet (k8s/api-deployment.yaml marks it `optional: true`).
 * - anything else failing (a query, SMTP, whatever) -> logged as an error
 *   and dropped until next month's run. There's nothing to retry into and
 *   nothing durable to corrupt, since Decision 6 persists nothing.
 */
@Injectable()
export class UsageMetricsReportService implements OnModuleInit {
  private readonly logger = new Logger(UsageMetricsReportService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usageMetricsService: UsageMetricsService,
    private readonly mailService: MailService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    if (CRON_DECISION.rejectedValue !== null) {
      this.logger.warn(
        `USAGE_REPORT_CRON="${CRON_DECISION.rejectedValue}" is not a valid cron expression — using the default "${CRON_DECISION.expression}" instead.`,
      );
    }
    this.logger.log(
      this.recipient()
        ? `Usage report scheduled ("${CRON_DECISION.expression}").`
        : `Usage report scheduled ("${CRON_DECISION.expression}") but USAGE_REPORT_RECIPIENT_EMAIL is not set — each run will no-op.`,
    );
  }

  @Cron(CRON_DECISION.expression, { name: USAGE_REPORT_JOB_NAME })
  async sendScheduledReport(): Promise<void> {
    // Claim first, then check config — the reverse order would log the
    // "no recipient configured" line once per replica instead of once per
    // run, which is exactly the kind of duplicated-across-pods noise this
    // lock exists to prevent.
    if (!(await this.tryClaimJobOrSkip(USAGE_REPORT_JOB_NAME))) {
      return;
    }

    const recipient = this.recipient();
    if (!recipient) {
      this.logger.log(
        'Skipping usage report — USAGE_REPORT_RECIPIENT_EMAIL is not set. Set it (see k8s/secret.yaml.example) to start receiving it.',
      );
      return;
    }

    try {
      const report = await this.usageMetricsService.collect();
      const email = buildUsageReportEmail(formatUsageReportSections(report));
      await this.mailService.sendMail({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      this.logger.log(
        `Usage report sent (window: ${report.windowDays} days, ${report.totalTeams} teams).`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to build/send the usage report — skipped until the next scheduled run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Identical shape to ClipRetentionService/AccountErasureSweepService's own
   * helper, including the try/catch code-critic's review of the
   * `replicas: 2` fix added there: a Redis hiccup must degrade to "skip this
   * tick", logged through this app's own Logger, not reject out of the
   * `@Cron` handler into the `cron` package's bare console.error.
   */
  private async tryClaimJobOrSkip(jobName: string): Promise<boolean> {
    try {
      const claimed = await this.redisService.tryClaimScheduledJobRun(
        jobName,
        USAGE_REPORT_JOB_LOCK_TTL_SECONDS,
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

  /**
   * The one address this report may go to, or null — in which case the run
   * no-ops. Three rejections, all degrading to that no-op and never
   * throwing, all found by the code-critic/security-reviewer pass:
   *
   * 1. **Empty string**, treated exactly like unset: a k8s Secret key
   *    created from an unset GitHub Actions secret arrives as '' (see
   *    config/env.validation.spec.ts for the boot crash this same behaviour
   *    caused elsewhere), and so does docker-compose's `${VAR:-}`.
   * 2. **The literal placeholder** from k8s/secret.yaml.example. That file
   *    is copied by hand to create the internal cluster's real Secret, so
   *    "left at CHANGE_ME" is a genuinely likely live state — and
   *    `CHANGE_ME` is truthy, so without this the job would compute a full
   *    report over real child-derived data and hand it to the SMTP relay
   *    addressed to nobody.
   * 3. **Anything that isn't exactly one address.** nodemailer treats `to`
   *    as a LIST, so a hand-typed "a@x.com, b@y.com" would silently fan
   *    this report out to several mailboxes — Decision 4's "sole consumer:
   *    the project owner" quietly stops being true, with nothing in the
   *    logs to notice. Deliberately a coarse plausibility check (one `@`,
   *    a dot in the domain, no separators/whitespace), not RFC 5321
   *    validation: the job's only real question is "is this one address",
   *    and anything stricter would start rejecting valid addresses.
   */
  private recipient(): string | null {
    const raw = this.configService
      .get<string>('USAGE_REPORT_RECIPIENT_EMAIL')
      ?.trim();
    if (!raw) return null;

    if (raw === SECRET_TEMPLATE_PLACEHOLDER) {
      this.logger.warn(
        `USAGE_REPORT_RECIPIENT_EMAIL is still the ${SECRET_TEMPLATE_PLACEHOLDER} placeholder from k8s/secret.yaml.example — treating it as unset and sending nothing.`,
      );
      return null;
    }

    if (!SINGLE_EMAIL_ADDRESS.test(raw)) {
      this.logger.warn(
        'USAGE_REPORT_RECIPIENT_EMAIL is not a single email address (this report goes to exactly one recipient — ADR-0020 Decision 4) — treating it as unset and sending nothing.',
      );
      return null;
    }
    return raw;
  }
}
