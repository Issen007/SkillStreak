import {
  HistogramBucketDefinition,
  POT_GROWTH_HISTOGRAM_BUCKETS,
  STREAK_HISTOGRAM_BUCKETS,
} from './usage-metrics.constants';
import {
  ActivePotGrowthRow,
  StreakValueCountRow,
  WeeklyCountRow,
} from './usage-metrics.query.service';
import {
  HistogramBar,
  TeamPoolGrowthMetric,
  TeamSizeBucket,
  TeamSizeBucketFigures,
  WeeklyCount,
} from './usage-metrics.types';

/**
 * docs/adr/0020-usage-analytics-product-metrics.md — the pure half of this
 * module. Everything here is a plain function over already-aggregated rows:
 * no repositories, no clock, no config lookups, so the parts that actually
 * decide what a reader sees (Decision 1's bucket boundaries, Decision 3's
 * minimum-population floor) are directly unit-testable rather than only
 * observable through a real database.
 */

/**
 * Whole percent. The empty-denominator rule (0, never NaN) is the same one
 * WeeklyGoalService.percentOf uses; the rounding deliberately is not — that
 * one keeps one decimal because a player-facing progress bar moves in small
 * steps, while a whole percent is the honest precision for a monthly
 * aggregate over tens of rows.
 */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** Team-weighted mean: each team contributes exactly one value regardless
 * of its size or how many rows it produced. See TeamSizeBucketedMetric's
 * docstring for why every per-bucket figure is one of these. */
export function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function bucketLabelFor(
  value: number,
  buckets: readonly HistogramBucketDefinition[],
): string {
  // The top bucket is open-ended (`max: null`), so `find` matches for every
  // non-negative value — which is all these histograms ever bin (streak
  // counts and points totals are both non-negative by construction). The
  // `??` is here because TypeScript needs a total expression, not as a
  // guard against a state that can occur.
  const match = buckets.find(
    (bucket) =>
      value >= bucket.min && (bucket.max === null || value <= bucket.max),
  );
  return match?.label ?? buckets[0].label;
}

/**
 * Turns "N players have streak value V" rows into Decision 1's fixed bars.
 * Every bar is always present, including empty ones — a histogram with a
 * silently-missing bar reads as "no data" rather than "zero", which is
 * exactly the wrong impression for the `0` bar in particular.
 */
export function buildHistogram(
  rows: { value: number; count: number }[],
  buckets: readonly HistogramBucketDefinition[],
): HistogramBar[] {
  const counts = new Map<string, number>(
    buckets.map((bucket) => [bucket.label, 0]),
  );
  for (const row of rows) {
    const label = bucketLabelFor(row.value, buckets);
    counts.set(label, (counts.get(label) ?? 0) + row.count);
  }
  return buckets.map((bucket) => ({
    bucket: bucket.label,
    count: counts.get(bucket.label) ?? 0,
  }));
}

export function buildStreakHistogram(
  rows: StreakValueCountRow[],
): HistogramBar[] {
  return buildHistogram(
    rows.map((row) => ({ value: row.streakCount, count: row.playerCount })),
    STREAK_HISTOGRAM_BUCKETS,
  );
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Metric 6 — points/week per active pot, then a distribution across them.
 *
 * Elapsed time is floored at one week: a pot whose season started two days
 * ago would otherwise report a wildly inflated weekly rate (its whole total
 * divided by 0.29 weeks), which reads as a real signal but is pure
 * arithmetic noise. A season that hasn't started yet (or a clock skew) is
 * treated the same way, for the same reason.
 */
export function computeTeamPoolGrowth(
  rows: ActivePotGrowthRow[],
  now: Date,
): TeamPoolGrowthMetric {
  const rates = rows.map((row) => {
    const startedAt = Date.parse(`${row.seasonStartDate}T00:00:00Z`);
    const elapsedWeeks = Number.isNaN(startedAt)
      ? 1
      : Math.max(1, (now.getTime() - startedAt) / MS_PER_WEEK);
    return row.pointsTotal / elapsedWeeks;
  });

  return {
    activePotCount: rows.length,
    medianPointsPerWeek: round1(median(rates)),
    histogram: buildHistogram(
      rates.map((rate) => ({ value: Math.round(rate), count: 1 })),
      POT_GROWTH_HISTOGRAM_BUCKETS,
    ),
  };
}

/** The middle value, not the mean — same choice, and same even-length
 * definition, as TeamPoolService.median (ADR-0016 Decision 2): one unusually
 * active team shouldn't drag the headline number. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Metric 7 — fills the gaps so the weekly series is continuous across the
 * whole window. Postgres returns no row at all for a week with zero clips/
 * messages, and a trend line that silently skips its quiet weeks overstates
 * how steady usage is.
 *
 * Weeks the window only partly covers are flagged, not hidden: the query
 * filters `created_at >= windowStart` (mid-week) and the run happens
 * mid-week too, so the first and last bars are always counted over fewer
 * than seven days. Unflagged, they read as a real drop at both ends of
 * every single report — a code-critic finding, and the kind of fake trend
 * this whole feature exists to avoid producing.
 */
export function fillWeeklySeries(
  rows: WeeklyCountRow[],
  windowStart: Date,
  now: Date,
): WeeklyCount[] {
  const counts = new Map(rows.map((row) => [row.weekStart, row.count]));
  const series: WeeklyCount[] = [];
  for (
    let cursor = startOfIsoWeekUtc(windowStart);
    cursor.getTime() <= now.getTime();
    cursor = new Date(cursor.getTime() + MS_PER_WEEK)
  ) {
    const weekStart = cursor.toISOString().slice(0, 10);
    const weekEnd = cursor.getTime() + MS_PER_WEEK;
    series.push({
      weekStart,
      count: counts.get(weekStart) ?? 0,
      partial:
        cursor.getTime() < windowStart.getTime() || weekEnd > now.getTime(),
    });
  }
  return series;
}

function startOfIsoWeekUtc(date: Date): Date {
  const midnight = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay(): 0 = Sunday. ISO weeks start on Monday, so Sunday is day 7.
  const isoDayOfWeek = midnight.getUTCDay() === 0 ? 7 : midnight.getUTCDay();
  midnight.setUTCDate(midnight.getUTCDate() - (isoDayOfWeek - 1));
  return midnight;
}

/**
 * **Decision 3's minimum-population floor — the security-reviewer's
 * required fix, 2026-08-02.**
 *
 * A team-size bucket is only a genuine aggregate if enough teams are in it.
 * At this app's real beta scale the `'1-2'` bucket could easily hold one
 * team — and a `'1-2'` team is at most two children, so "% of teams in this
 * bucket completed their weekly goal" would resolve to one child's
 * behaviour. The review's fix: below the floor, the bucket is **not
 * reported at all**; those teams stay counted in the metric's app-wide
 * number (which always covers every team), and the report simply doesn't
 * break that metric out by team size that period.
 *
 * This function additionally applies **complementary suppression**, which
 * the ADR doesn't spell out but its own reasoning requires: with three
 * buckets and a published app-wide total, suppressing exactly one bucket
 * leaves it trivially derivable by subtraction (app-wide minus the two
 * printed buckets), which would defeat the floor entirely. So after
 * dropping every below-floor bucket, if the *residual* (the teams not in
 * any printed bucket) is itself non-empty but below the floor, the smallest
 * printed bucket is dropped too, until the residual is either empty or big
 * enough to be an aggregate in its own right. This only ever suppresses
 * MORE than Decision 3 asks for, never less — which is free here, since
 * Decision 3 already notes this internal report has no
 * legibility-to-the-affected-party purpose that suppression could damage.
 *
 * Callers must pass every team exactly once across `buckets` (the
 * partition property this derivation relies on) — UsageMetricsService
 * guarantees that by bucketing every team it saw, including teams with zero
 * eligible players.
 */
export function applyMinimumPopulationFloor<T>(
  buckets: TeamSizeBucketFigures<T>[],
  minTeamsPerBucket: number,
): TeamSizeBucketFigures<T>[] {
  const totalTeams = buckets.reduce((sum, entry) => sum + entry.teamCount, 0);
  let reported = buckets.filter(
    (entry) => entry.teamCount >= minTeamsPerBucket,
  );

  for (;;) {
    const residual =
      totalTeams - reported.reduce((sum, entry) => sum + entry.teamCount, 0);
    if (residual === 0 || residual >= minTeamsPerBucket) break;
    if (reported.length === 0) break;
    const smallest = reported.reduce((min, entry) =>
      entry.teamCount < min.teamCount ? entry : min,
    );
    reported = reported.filter((entry) => entry !== smallest);
  }

  return sortByTeamSizeBucket(reported);
}

const TEAM_SIZE_BUCKET_ORDER: TeamSizeBucket[] = ['1-2', '3-5', '6+'];

export function sortByTeamSizeBucket<T>(
  buckets: TeamSizeBucketFigures<T>[],
): TeamSizeBucketFigures<T>[] {
  return [...buckets].sort(
    (a, b) =>
      TEAM_SIZE_BUCKET_ORDER.indexOf(a.bucket) -
      TEAM_SIZE_BUCKET_ORDER.indexOf(b.bucket),
  );
}
