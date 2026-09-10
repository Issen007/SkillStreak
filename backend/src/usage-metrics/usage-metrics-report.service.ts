import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { MailService } from '../mail/mail.service';
import { buildUsageReportEmail } from '../mail/templates/usage-report-email.template';
import { resolveSingleReportRecipient } from '../common/mail/report-recipient.util';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { RedisService } from '../redis/redis.service';
import { USAGE_REPORT_JOB_NAME } from './usage-metrics.constants';
import { UsageMetricsService } from './usage-metrics.service';
import { formatUsageReportSections } from './usage-report-sections';
import { resolveUsageReportCron } from './usage-report-cron.util';

// Evaluated once, at import time — see resolveUsageReportCron's docstring
// for why the cadence has to be read from process.env here rather than
// through ConfigService, and why a malformed value degrades to the monthly
// default instead of crashing boot.
const CRON_DECISION = resolveUsageReportCron();

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
    private readonly errorLogService: ErrorLogService,
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
    if (!(await this.claimRun(USAGE_REPORT_JOB_NAME))) {
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
      // docs/adr/0022-admin-control-center.md Decision 6 — this catch used
      // to end at the log line above, i.e. a failed monthly report was only
      // ever visible to whoever happened to be reading pod stdout that day.
      // It now also gets a durable `error_log_entry` row (`source: 'job'`),
      // which is the difference between "the report never arrived" being a
      // mystery and being a lookup.
      await this.errorLogService.record({
        source: 'job',
        jobName: ERROR_LOG_JOB_NAMES.usageMetricsReport,
        error,
      });
    }
  }

  /**
   * The one address this report may go to, or null — in which case the
   * run no-ops. The three rejections this applies (empty string, the
   * CHANGE_ME placeholder, anything that isn't exactly one address) and
   * the reasoning behind each now live in
   * common/mail/report-recipient.util.ts, shared with ADR-0037's weekly
   * suggestion digest. Rejection 3 matters most here: ADR-0020 Decision
   * 4's "sole consumer: the project owner" is what a comma-separated
   * value would quietly stop being true of.
   */
  private recipient(): string | null {
    return resolveSingleReportRecipient({
      value: this.configService.get<string>('USAGE_REPORT_RECIPIENT_EMAIL'),
      envVarName: 'USAGE_REPORT_RECIPIENT_EMAIL',
      logger: this.logger,
    });
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
