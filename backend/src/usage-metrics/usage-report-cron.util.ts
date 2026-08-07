import { CronTime } from 'cron';
import { DEFAULT_USAGE_REPORT_CRON } from './usage-metrics.constants';

export interface UsageReportCronDecision {
  expression: string;
  /** The configured value, when it was set but rejected — so the service
   * can say so out loud at boot instead of silently running on the default. */
  rejectedValue: string | null;
}

/**
 * docs/adr/0020-usage-analytics-product-metrics.md Decision 6 — cadence is
 * "a config value (e.g. a cron expression), not a schema decision... the
 * project owner should feel free to pick weekly or quarterly instead
 * without this ADR needing revisiting". Hence USAGE_REPORT_CRON rather than
 * a hardcoded `CronExpression` constant like the sibling sweeps use.
 *
 * Read from `process.env` rather than ConfigService because `@Cron`'s
 * argument is evaluated when this module is first imported, before Nest
 * builds any provider — every deployed environment supplies it through the
 * real process environment anyway (k8s ConfigMap / docker-compose
 * `environment:`), and local `.env` values are already in `process.env` by
 * then too, since database/data-source.ts calls dotenv's `config()` at
 * import time and app.module.ts imports DatabaseModule first.
 *
 * **Validated by constructing the real `CronTime`, not by a regex.** This
 * was a confirmed crash, not a hypothetical: an expression that merely
 * *looks* right (`60 6 1 * *`, `0 24 1 * *`, `0 6 32 * *`, `0 6 1 13 *` —
 * the four most likely typos) throws "Field value is out of range" from
 * @nestjs/schedule's `SchedulerOrchestrator.mountCron()`, which runs inside
 * `onApplicationBootstrap` with no try/catch of its own, so the throw
 * escapes `app.init()` and every replica CrashLoopBackOffs. Verified live
 * against this repo's own AppModule before this validation existed. A
 * hand-written range check would only ever *approximate* the parser that
 * actually decides; asking that parser directly makes "accepted here" and
 * "accepted by the scheduler" the same set by construction.
 *
 * `cron` is a direct dependency of this package for exactly that reason,
 * pinned to the same exact version @nestjs/schedule itself depends on
 * (4.4.0, no caret) so the two can never drift onto different parsers. It
 * is not a new library in the tree — it is the scheduler @nestjs/schedule
 * has always been a thin wrapper over; it just wasn't resolvable from this
 * package's own code until it was declared here (pnpm's strict, non-flat
 * node_modules), and @nestjs/schedule re-exports neither `CronTime` nor
 * `CronJob`.
 */
export function resolveUsageReportCron(
  env: NodeJS.ProcessEnv = process.env,
): UsageReportCronDecision {
  const raw = env.USAGE_REPORT_CRON?.trim();
  if (!raw) {
    return { expression: DEFAULT_USAGE_REPORT_CRON, rejectedValue: null };
  }
  try {
    // Constructed purely for its validation side effect and thrown away —
    // the scheduler builds its own from the string we hand `@Cron`.
    new CronTime(raw);
    return { expression: raw, rejectedValue: null };
  } catch {
    return { expression: DEFAULT_USAGE_REPORT_CRON, rejectedValue: raw };
  }
}
