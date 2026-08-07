import { ActivityType } from '../training-logs/activity-type.enum';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';

/**
 * docs/adr/0020-usage-analytics-product-metrics.md Decision 1's fixed
 * allow-list, expressed as types. This file is the contract the whole
 * module is built around: **if a field isn't here, the report doesn't
 * compute it** — Decision 1 is an allow-list, not a starting point, and
 * Decision 3 makes the *shape* (aggregate-only) as load-bearing as the
 * field list itself.
 *
 * Two shapes appear repeatedly and mean different things:
 *
 * - a plain figure/histogram — app-wide, across every team, no
 *   stratification at all (Decision 3's "default and primary shape");
 * - `TeamSizeBucketedMetric<T>` — app-wide PLUS a `'1-2'`/`'3-5'`/`'6+'`
 *   eligible-player-count breakdown, allowed for exactly the two metrics
 *   Decision 1 lists it for (adoption/consent funnel, weekly-goal
 *   engagement) and never for anything else.
 *
 * There is deliberately no type anywhere in this file that can hold a team
 * name, a team id, a player id, a screen name, or any freeform text — the
 * output shape itself, not just the queries, refuses Decision 3's excluded
 * cases.
 */

/** ADR-0016's addendum bucketing, reused verbatim via
 * TeamPoolService.bucketEligiblePlayerCount — never re-derived here. */
export type TeamSizeBucket = '1-2' | '3-5' | '6+';

export interface TeamSizeBucketFigures<T> {
  bucket: TeamSizeBucket;
  /** How many TEAMS this bucket aggregates. Always >= the run's
   * minimum-population floor (Decision 3) — a bucket that couldn't clear
   * the floor is absent from the array entirely, never present with a
   * suppressed/`null` payload. */
  teamCount: number;
  figures: T;
}

/**
 * Two type parameters, not one, because the app-wide and per-bucket figures
 * are deliberately *different statistics* — a code-critic finding worth
 * encoding in the types rather than a comment.
 *
 * App-wide numbers are pooled totals (all players, all goals). A pooled
 * total inside a bucket, though, is dominated by whichever team contributed
 * most rows: a `'1-2'` bucket of five teams where one captain ran 8 of the
 * 12 goals is two-thirds one team's outcome, and a `'1-2'` team is at most
 * two children — so the floor would be binding on team count while the
 * statistic varied with something else entirely. Every per-bucket figure is
 * therefore a **team-weighted mean over that bucket's teams** (each team
 * contributes exactly one value, whatever its size or activity), and the
 * per-bucket types are named `mean*` so a reader can't mistake one for a
 * total.
 */
export interface TeamSizeBucketedMetric<TAppWide, TBucket> {
  appWide: TAppWide;
  /**
   * Empty whenever Decision 3's floor can't be met — which, at this app's
   * current beta scale, is the expected case, not an error. The app-wide
   * number above always covers every team either way, so an empty array
   * here means "not broken out this period", never "these teams were
   * dropped from the totals".
   */
  byTeamSizeBucket: TeamSizeBucketFigures<TBucket>[];
  /**
   * True when at least one non-empty bucket was folded into the app-wide
   * figures by the floor — including the partial case, where some buckets
   * ARE printed. The report's own note is driven off this so suppression is
   * never silent (Decision 3 asks for no visible *gap in the data*, which
   * is not the same as hiding from the one person reading the report that a
   * breakdown was withheld). Deliberately a boolean, not a count of the
   * suppressed buckets or teams: the reader needs to know a fold happened,
   * not how big the residual is.
   */
  foldedIntoAppWide: boolean;
}

// --- Metric 1: adoption/consent funnel ---------------------------------------

export interface AdoptionFunnelFigures {
  totalPlayers: number;
  /** Every ParentalConsentStatus value is always present, including zeros
   * — an absent key would be ambiguous between "none" and "not measured". */
  playersByParentalConsentStatus: Record<ParentalConsentStatus, number>;
  playersByTeamJoinStatus: Record<TeamJoinStatus, number>;
  playersWithAtLeastOneTrainingLog: number;
  percentWithAtLeastOneTrainingLog: number;
}

/**
 * The per-bucket funnel: three team-weighted means, never the pooled counts
 * above. Pooling inside a bucket would let one unusually large team define
 * it — and the buckets are keyed on a team's *eligible* player count, so a
 * team with 40 members all still consent-pending sits in `'1-2'` and would
 * have swamped every pooled figure there.
 */
export interface AdoptionFunnelBucketFigures {
  /** Mean roster size (all players, not just eligible ones) per team. */
  meanPlayersPerTeam: number;
  /** Mean, across this bucket's teams, of each team's own % of players
   * with parental consent approved. */
  meanPercentConsentApproved: number;
  /** Mean, across this bucket's teams, of each team's own % of players who
   * have ever logged a training session. */
  meanPercentWithTrainingLog: number;
}

// --- Metric 2: individual-streak health --------------------------------------

export interface HistogramBar {
  bucket: string;
  count: number;
}

export interface StreakHealthMetric {
  totalPlayers: number;
  currentStreakHistogram: HistogramBar[];
  longestStreakHistogram: HistogramBar[];
}

// --- Metric 3: activity recency ----------------------------------------------

export interface ActivityRecencyMetric {
  totalPlayers: number;
  playersActiveLast7Days: number;
  percentActiveLast7Days: number;
  /** Named for the window, not "30 days": the second cutoff IS the report
   * window (USAGE_METRICS_WINDOW_DAYS), so a field called
   * `...Last30Days` would silently start lying the day that constant
   * changes. The rendered label is derived from the same constant. */
  playersActiveInWindow: number;
  percentActiveInWindow: number;
}

// --- Metric 4: training-type mix ---------------------------------------------

export interface TrainingTypeMixEntry {
  activityType: ActivityType;
  logCount: number;
  percentOfLogs: number;
}

// --- Metric 5: weekly-goal engagement ----------------------------------------

export interface WeeklyGoalEngagementFigures {
  /** Weekly goals that ran to the end of their own window inside the report
   * window without being cancelled — the denominator. */
  concludedGoalCount: number;
  /** Of those, the ones met under ADR-0015's per-player definition
   * (`goal_bonus_awarded_at IS NOT NULL`), NOT `status = 'completed'`. */
  completedGoalCount: number;
  percentCompleted: number;
  /** Excluded from the rate above, reported alongside it: a captain
   * cancelling every goal that isn't going well must not be able to make
   * the completion rate look better. */
  cancelledGoalCount: number;
}

/** The per-bucket weekly-goal figure: the mean of each team's own
 * completion rate, one value per team, so a captain who ran eight goals
 * doesn't outweigh four teammates' teams who ran one each. */
export interface WeeklyGoalBucketFigures {
  meanTeamCompletionPercent: number;
}

// --- Metric 6: team-pool (VM-Guld) engagement --------------------------------

export interface TeamPoolGrowthMetric {
  activePotCount: number;
  /** Points/week, median across active pots — the middle of the
   * distribution, same "one outlier roster shouldn't move it" reasoning
   * ADR-0016 Decision 2 already applies to its own median. */
  medianPointsPerWeek: number;
  histogram: HistogramBar[];
}

// --- Metric 7: social-feature usage (counts only) ----------------------------

export interface WeeklyCount {
  /** ISO 'YYYY-MM-DD' of the week's Monday. */
  weekStart: string;
  count: number;
  /**
   * True when the report window covers only part of this ISO week — always
   * the case for the first week (the window starts mid-week) and the last
   * (the run happens mid-week). Rendered as "(partial)" rather than being
   * dropped: without it, every report showed a dip at both ends that looked
   * like a usage trend and was pure windowing.
   */
  partial: boolean;
}

export interface SocialUsageMetric {
  clipUploadsPerWeek: WeeklyCount[];
  chatMessagesPerWeek: WeeklyCount[];
}

// --- Metric 8: badge mix -----------------------------------------------------

export interface BadgeMixEntry {
  badgeId: string;
  /** From the fixed `badge` catalog, purely so the report is readable
   * ("streak_7" beats a bare uuid). Catalog metadata, never child data. */
  badgeKey: string | null;
  awardCount: number;
}

// --- The whole report --------------------------------------------------------

export interface UsageMetricsReport {
  generatedAt: Date;
  /** Trailing window the window-scoped metrics cover (Decision 6). */
  windowStart: Date;
  windowDays: number;
  /** The floor actually applied this run (Decision 3) — printed in the
   * report so a reader can tell an absent breakdown from a mis-set config. */
  minTeamsPerBucket: number;
  /**
   * Total teams considered when stratifying. Deliberately NOT rendered in
   * the email: printing it next to each shown bucket's `teamCount` is
   * precisely what would let a reader do the residual arithmetic the floor
   * exists to prevent. It exists for the job's own single operator log
   * line, which no report recipient sees.
   */
  totalTeams: number;

  adoptionFunnel: TeamSizeBucketedMetric<
    AdoptionFunnelFigures,
    AdoptionFunnelBucketFigures
  >;
  streakHealth: StreakHealthMetric;
  activityRecency: ActivityRecencyMetric;
  trainingTypeMix: TrainingTypeMixEntry[];
  weeklyGoalEngagement: TeamSizeBucketedMetric<
    WeeklyGoalEngagementFigures,
    WeeklyGoalBucketFigures
  >;
  teamPoolGrowth: TeamPoolGrowthMetric;
  socialUsage: SocialUsageMetric;
  badgeMix: BadgeMixEntry[];
}
