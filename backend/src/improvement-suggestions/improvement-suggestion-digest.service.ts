import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { resolveSingleReportRecipient } from '../common/mail/report-recipient.util';
import { tryClaimScheduledJobRunOrSkip } from '../common/scheduling/scheduled-job-run.util';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { MailService } from '../mail/mail.service';
import { buildImprovementSuggestionDigestEmail } from '../mail/templates/improvement-suggestion-digest-email.template';
import { RedisService } from '../redis/redis.service';
import {
  IMPROVEMENT_SUGGESTION_DIGEST_CRON,
  IMPROVEMENT_SUGGESTION_DIGEST_WINDOW_DAYS,
} from './improvement-suggestions.constants';
import {
  ImprovementSuggestion,
  ImprovementSuggestionStatus,
} from './entities/improvement-suggestion.entity';

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — the weekly nudge.
 *
 * The project owner's call on 2026-09-09 was "console queue + a weekly
 * digest mail", and the digest carries **counts only, never a
 * suggestion's text**. See the template's own header for why that
 * boundary is where it is; this service is the half that enforces it, by
 * never reading `body` at all — the queries below are `count`s, so the
 * text is not in memory here to leak into a mail even by mistake.
 *
 * Multi-replica safe the way every other scheduled job in this app is
 * (k8s/api-deployment.yaml runs `replicas: 2`): a non-blocking Redis
 * try-lock, and the run that loses the race does nothing rather than
 * waiting. Without it the owner would get one copy per pod.
 *
 * Two graceful-degradation paths, both deliberate, both logged rather
 * than thrown — a reporting job must never take the API down:
 *
 * - **Recipient not configured** → no-op with a log line. Reuses
 *   `USAGE_REPORT_RECIPIENT_EMAIL` rather than introducing a second
 *   address knob, deliberately: it is already "the project owner's
 *   address for scheduled internal reports" in both clusters' Secrets,
 *   and this repo has been broken three separate times by a Secret key
 *   that existed in GitHub and not in the cluster. A new key here would
 *   be a fourth chance at exactly that, in exchange for the ability to
 *   send two internal reports to two different mailboxes — which nobody
 *   has asked for.
 * - **Anything else failing** (a query, SMTP, whatever) → logged and
 *   recorded as an `error_log_entry` row, then dropped until next week.
 *   Nothing durable is corrupted by a missed digest: the queue is still
 *   the queue.
 */
@Injectable()
export class ImprovementSuggestionDigestService {
  private readonly logger = new Logger(ImprovementSuggestionDigestService.name);

  constructor(
    @InjectRepository(ImprovementSuggestion)
    private readonly improvementSuggestionRepository: Repository<ImprovementSuggestion>,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly redisService: RedisService,
    private readonly errorLogService: ErrorLogService,
  ) {}

  @Cron(IMPROVEMENT_SUGGESTION_DIGEST_CRON, {
    name: ERROR_LOG_JOB_NAMES.improvementSuggestionDigest,
  })
  async sendWeeklyDigest(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.improvementSuggestionDigest;
    // Claim first, then check config — the reverse order would log the
    // "no recipient configured" line once per replica instead of once per
    // run, which is the duplicated-across-pods noise this lock exists to
    // prevent.
    if (!(await this.claimRun(jobName))) {
      return;
    }

    const recipient = this.recipient();
    if (!recipient) {
      this.logger.log(
        'Skipping the improvement-suggestion digest — USAGE_REPORT_RECIPIENT_EMAIL is not set. Set it (see k8s/secret.yaml.example) to start receiving it.',
      );
      return;
    }

    try {
      const windowDays = IMPROVEMENT_SUGGESTION_DIGEST_WINDOW_DAYS;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      const [newInWindow, open, triaged, closed] = await Promise.all([
        this.improvementSuggestionRepository.count({
          where: { createdAt: MoreThanOrEqual(since) },
        }),
        this.countByStatus(ImprovementSuggestionStatus.OPEN),
        this.countByStatus(ImprovementSuggestionStatus.TRIAGED),
        this.countByStatus(ImprovementSuggestionStatus.CLOSED),
      ]);

      // Nothing new AND nothing waiting: send no mail. A weekly "0, 0" is
      // how a digest teaches its one reader to filter it away, and this
      // repo has already learned that lesson the expensive way from
      // permanently-red expo-doctor (see CLAUDE.md). A week with an open
      // backlog and no arrivals still sends — that one is not noise, it is
      // the queue asking to be looked at.
      if (newInWindow === 0 && open === 0) {
        this.logger.log(
          'Improvement-suggestion digest: nothing new and nothing open — no mail sent.',
        );
        return;
      }

      const email = buildImprovementSuggestionDigestEmail({
        newInWindow,
        open,
        triaged,
        closed,
        windowDays,
        generatedOn: new Date().toISOString().slice(0, 10),
      });
      await this.mailService.sendMail({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      this.logger.log(
        `Improvement-suggestion digest sent (${newInWindow} new in ${windowDays} days, ${open} open).`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to build/send the improvement-suggestion digest — skipped until the next scheduled run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  private countByStatus(status: ImprovementSuggestionStatus): Promise<number> {
    return this.improvementSuggestionRepository.count({ where: { status } });
  }

  /** See the class docstring for why this shares the usage report's key
   * rather than declaring one of its own. */
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
