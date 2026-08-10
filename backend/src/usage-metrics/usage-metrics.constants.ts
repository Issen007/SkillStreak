// docs/adr/0020-usage-analytics-product-metrics.md — every tunable number
// this feature has, in one place. Decision 6 is explicit that cadence (and,
// via Decision 3's amendment, the minimum-population floor) are business
// judgment calls with easy-to-revisit defaults, not architectural
// constants: the three values below that have a matching env var say so in
// their own comment, and the ones that don't are presentation-only bucket
// boundaries (a histogram's bars), not policy.

/**
 * Decision 6's default cadence: monthly ("a slow-moving decision, not one
 * that benefits from weekly noise"). 06:00 on the 1st of every month —
 * early enough that the report is waiting in the inbox at the start of the
 * day, late enough that it never collides with the midnight retention/
 * erasure sweeps (ClipRetentionService/AccountErasureSweepService).
 * Overridable via USAGE_REPORT_CRON — see resolveUsageReportCron().
 */
export const DEFAULT_USAGE_REPORT_CRON = '0 6 1 * *';

/**
 * Decision 6's "recompute fresh each run over a trailing window (e.g. the
 * last 30 days as of run time)" — no persistence, no history table, so
 * this window is the only thing that makes a run's window-scoped metrics
 * comparable report-to-report. Deliberately NOT an env var: changing it
 * silently would make two reports in the same inbox non-comparable with no
 * way to tell (every report prints its own window, but nothing would flag
 * that the *previous* one used a different one).
 */
export const USAGE_METRICS_WINDOW_DAYS = 30;

/**
 * Decision 3's security-reviewer-required minimum-population floor: a
 * team-size bucket containing fewer than this many TEAMS is never reported
 * as its own bucket for that period. The review recommends N >= 5 and
 * explicitly calls this "tunable, a config value like Decision 6's
 * cadence, not an architectural constant" — hence
 * USAGE_REPORT_MIN_TEAMS_PER_BUCKET, with this as the default. Raising it
 * is always safe; lowering it below 2 is refused at read time (see
 * UsageMetricsService.minTeamsPerBucket) because a "bucket" of one team is
 * exactly the degenerate case this floor exists to prevent.
 */
export const DEFAULT_USAGE_REPORT_MIN_TEAMS_PER_BUCKET = 5;
export const MINIMUM_USAGE_REPORT_MIN_TEAMS_PER_BUCKET = 2;

/**
 * The Redis run-claim key for the monthly job — same non-blocking try-lock
 * mechanism (and same TTL reasoning) as ClipRetentionService's two sweeps
 * and AccountErasureSweepService's, so only one of k8s/api-deployment.yaml's
 * replicas actually computes and emails a given month's report.
 */
export const USAGE_REPORT_JOB_NAME = 'usage-metrics:report';

/**
 * Decision 1's fixed streak-histogram buckets, verbatim (`0`, `1-3`,
 * `4-7`, `8-14`, `15-30`, `31+`). `max: null` is the open-ended top
 * bucket. Order matters — the report prints these in this order.
 */
export interface HistogramBucketDefinition {
  label: string;
  min: number;
  max: number | null;
}

export const STREAK_HISTOGRAM_BUCKETS: readonly HistogramBucketDefinition[] = [
  { label: '0', min: 0, max: 0 },
  { label: '1-3', min: 1, max: 3 },
  { label: '4-7', min: 4, max: 7 },
  { label: '8-14', min: 8, max: 14 },
  { label: '15-30', min: 15, max: 30 },
  { label: '31+', min: 31, max: null },
];

/**
 * Decision 1's team-pool metric is a *distribution* of points/week across
 * active pots, not a ranking and not a per-pot list — so it's reported as
 * a histogram, the same shape (and for the same "never a sorted list of
 * individual values" reason) as the streak histogram above. Boundaries are
 * anchored to this app's actual points formula: 1 point per minute trained
 * (training-logs/points.util.ts), so a 6-player team averaging 15 min/day
 * lands around 630 points/week. Presentation only — no env var, since
 * moving a bar boundary changes nothing about what data is read.
 */
export const POT_GROWTH_HISTOGRAM_BUCKETS: readonly HistogramBucketDefinition[] =
  [
    { label: '0', min: 0, max: 0 },
    { label: '1-99', min: 1, max: 99 },
    { label: '100-499', min: 100, max: 499 },
    { label: '500-1499', min: 500, max: 1499 },
    { label: '1500+', min: 1500, max: null },
  ];
