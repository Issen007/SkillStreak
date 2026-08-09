import {
  ActivityRecencyMetric,
  AdoptionFunnelBucketFigures,
  AdoptionFunnelFigures,
  BadgeMixEntry,
  SocialUsageMetric,
  StreakHealthMetric,
  TeamPoolGrowthMetric,
  TeamSizeBucketedMetric,
  TrainingTypeMixEntry,
  UsageMetricsReport,
  WeeklyGoalBucketFigures,
  WeeklyGoalEngagementFigures,
} from '../usage-metrics/usage-metrics.types';

/**
 * docs/adr/0022-admin-control-center.md Decision 4/5 and
 * docs/design/phase7-admin-console-flows.md §4.1/§13 — the wire shape of
 * `GET /api/v1/admin/usage-metrics`.
 *
 * **`totalTeams` is structurally absent, not merely un-rendered.** This is
 * the security property of this file, and it has its own test
 * (admin-usage-metrics.view.spec.ts) rather than being left to review.
 * `UsageMetricsReport.totalTeams`'s own docstring already explains why the
 * monthly email never prints it: showing it alongside each visible bucket's
 * `teamCount` is exactly the residual arithmetic ADR-0020 Decision 3's
 * minimum-population floor exists to prevent. §4.1's argument is that a
 * browsable, on-demand web view is a *stronger* version of that risk than a
 * static email, so §13's instruction is to drop the field from the DTO
 * entirely — "structural, not by policy", the same standard Decision 5 holds
 * itself to.
 *
 * **`foldedIntoAppWide` and `minTeamsPerBucket` must reach the browser** and
 * do (the former per metric, the latter once per report — the shape
 * `UsageMetricsService` already produces). Without them the console cannot
 * tell §4.4's state C ("every bucket was withheld") from state D ("there are
 * no teams"), which are opposite facts the operator acts on differently.
 * `minTeamsPerBucket` is also what the copy interpolates instead of a
 * hardcoded `5`, which would start lying the day
 * `USAGE_REPORT_MIN_TEAMS_PER_BUCKET` is raised.
 *
 * **No `teamId`, `playerId`, `screenName`, or team name exists anywhere in
 * these types** — Decision 5's structural floor. They can't: every type
 * below is either reused verbatim from `usage-metrics.types.ts` (which
 * already refuses those shapes by construction) or is a plain scalar. A
 * future per-team breakdown would require new query code *and* new response
 * fields here — two visible, reviewable changes, not a side effect of wiring
 * up a UI filter.
 *
 * **`withheldBuckets` is deliberately not built.** §13 lists it as optional
 * ("build the field only if the naming is actually wanted") and §4.4 is
 * specified to be complete and honest without it.
 */
export interface AdminUsageMetricsResponse {
  /** ISO-8601. Serialized here rather than left as a `Date` so the wire
   * contract is explicit rather than a side effect of JSON.stringify. */
  generatedAt: string;
  windowStart: string;
  windowDays: number;
  minTeamsPerBucket: number;

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

/**
 * Field-by-field construction, **never** `{ ...report }` with a delete or an
 * `Omit` cast. A spread would mean that any field a future contributor adds
 * to `UsageMetricsReport` — for the monthly email's own purposes, quite
 * possibly without ever opening this file — lands on a public admin endpoint
 * automatically. Listing the fields makes this an allow-list, the same
 * instinct ADR-0020 Decision 1 applies to the metric set itself.
 *
 * Note there is no `teamId`/`playerId` parameter, here or on
 * `UsageMetricsService.collect` — Decision 5: the type signatures have no
 * such shape for a filter control to be wired to in the first place.
 */
export function toAdminUsageMetricsResponse(
  report: UsageMetricsReport,
): AdminUsageMetricsResponse {
  return {
    generatedAt: report.generatedAt.toISOString(),
    windowStart: report.windowStart.toISOString(),
    windowDays: report.windowDays,
    minTeamsPerBucket: report.minTeamsPerBucket,
    // report.totalTeams is deliberately NOT copied — see this file's
    // docstring. Do not add it.
    adoptionFunnel: report.adoptionFunnel,
    streakHealth: report.streakHealth,
    activityRecency: report.activityRecency,
    trainingTypeMix: report.trainingTypeMix,
    weeklyGoalEngagement: report.weeklyGoalEngagement,
    teamPoolGrowth: report.teamPoolGrowth,
    socialUsage: report.socialUsage,
    badgeMix: report.badgeMix,
  };
}
