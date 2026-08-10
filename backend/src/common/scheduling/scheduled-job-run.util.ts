import { Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * How long a scheduled job's cross-pod run-claim is held.
 *
 * Five minutes, which is what all six callers independently chose before
 * this was extracted — generous headroom for one run, short enough that a
 * pod crashing mid-run doesn't wedge the next tick's claim. Previously
 * spelled four different ways (ERROR_LOG_JOB_LOCK_TTL_SECONDS,
 * USAGE_REPORT_JOB_LOCK_TTL_SECONDS, and two file-local
 * SCHEDULED_JOB_LOCK_TTL_SECONDS constants), all equal to this.
 */
export const SCHEDULED_JOB_LOCK_TTL_SECONDS = 5 * 60;

/**
 * Claims this tick's run of a scheduled job, or reports that it should be
 * skipped.
 *
 * The API runs `replicas: 2`, so every `@Cron` handler fires on both pods
 * at the same moment. This is what makes exactly one of them do the work:
 * a non-blocking Redis claim keyed on the job name.
 *
 * **Both failure modes are "skip this tick", deliberately.** Losing the
 * claim means another replica is already doing it. Failing to reach Redis
 * at all means we cannot know, and every caller here is an idempotent
 * periodic job whose next tick will do the same work — so declining is
 * free, while guessing risks two pods running the same DELETE or sending
 * the same report twice. A failed lock check is therefore NOT recorded as
 * a job failure by callers: nothing was attempted, so there is nothing to
 * report.
 *
 * The caller passes its own `Logger` so the skip lines keep naming the
 * service they came from rather than all claiming to be this file.
 *
 * Extracted 2026-08-10 from six verbatim copies (clip retention ×2,
 * account erasure, usage-metrics report, error-log retention, bug-report
 * retention, event-registration retention). BugReportRetentionService's
 * docstring had flagged five as already past the point where this was
 * worth doing.
 */
export async function tryClaimScheduledJobRunOrSkip(
  redisService: RedisService,
  logger: Logger,
  jobName: string,
  ttlSeconds: number = SCHEDULED_JOB_LOCK_TTL_SECONDS,
): Promise<boolean> {
  try {
    const claimed = await redisService.tryClaimScheduledJobRun(
      jobName,
      ttlSeconds,
    );
    if (!claimed) {
      logger.debug(
        `Skipping ${jobName} — another replica already claimed this run.`,
      );
    }
    return claimed;
  } catch (error) {
    logger.warn(
      `Skipping ${jobName} this tick — failed to check the Redis run-lock: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}
