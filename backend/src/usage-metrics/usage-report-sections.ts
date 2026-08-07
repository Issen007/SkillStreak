import {
  UsageReportEmailInput,
  UsageReportEmailSection,
} from '../mail/templates/usage-report-email.template';
import {
  AdoptionFunnelBucketFigures,
  HistogramBar,
  TeamSizeBucketedMetric,
  UsageMetricsReport,
  WeeklyCount,
  WeeklyGoalBucketFigures,
} from './usage-metrics.types';

/**
 * docs/adr/0020-usage-analytics-product-metrics.md Decision 5 — turns a
 * computed report into the plain, domain-free section list
 * mail/templates/usage-report-email.template.ts renders. Pure and
 * synchronous, so what the project owner actually reads is unit-testable
 * without SMTP, a database, or a clock.
 *
 * One presentation rule carries real weight, not just polish: whenever a
 * team-size breakdown was folded into the app-wide figures by Decision 3's
 * minimum-population floor — **including the partial case, where some
 * buckets are still printed** — the section says so in its own note. The
 * ADR asks for the fold-in to be invisible as a *gap in the data* (no blank
 * row, no "n/a" bucket implying a hidden number); it does not ask for the
 * suppression itself to be hidden from the one person reading the report,
 * and hiding it is how a reader ends up believing the missing buckets
 * simply had no teams in them.
 *
 * Every per-bucket figure is a team-weighted mean (see
 * TeamSizeBucketedMetric's docstring), so each line says "mean" and each
 * note says so in words — a mean and a pooled total answer different
 * questions and must not be confusable at a glance.
 */
export function formatUsageReportSections(
  report: UsageMetricsReport,
): UsageReportEmailInput {
  const generatedOn = isoDate(report.generatedAt);
  const windowLabel = `trailing ${report.windowDays} days, ${isoDate(
    report.windowStart,
  )} to ${generatedOn}`;

  return {
    generatedOn,
    windowLabel,
    sections: [
      adoptionFunnelSection(report),
      streakHealthSection(report),
      activityRecencySection(report),
      trainingTypeMixSection(report),
      weeklyGoalSection(report),
      teamPoolSection(report),
      socialUsageSection(report),
      badgeMixSection(report),
    ],
  };
}

function adoptionFunnelSection(
  report: UsageMetricsReport,
): UsageReportEmailSection {
  const { appWide } = report.adoptionFunnel;
  const lines = [
    `Players total: ${appWide.totalPlayers}`,
    `Parental consent: ${formatCounts(appWide.playersByParentalConsentStatus)}`,
    `Team join status: ${formatCounts(appWide.playersByTeamJoinStatus)}`,
    `Logged at least one training session (ever): ${appWide.playersWithAtLeastOneTrainingLog} (${appWide.percentWithAtLeastOneTrainingLog}%)`,
    ...teamSizeLines(report.adoptionFunnel, funnelBucketLine),
  ];

  return {
    heading: 'Adoption & consent funnel',
    lines,
    note: bucketNote(
      report.adoptionFunnel,
      report.minTeamsPerBucket,
      'Current status of every player, not window-scoped — the last step counts any training log ever, while "still training" is the activity-recency section below.',
    ),
  };
}

function funnelBucketLine(figures: AdoptionFunnelBucketFigures): string {
  return `mean ${figures.meanPlayersPerTeam} players/team, mean ${figures.meanPercentConsentApproved}% consent-approved, mean ${figures.meanPercentWithTrainingLog}% have logged training`;
}

function streakHealthSection(
  report: UsageMetricsReport,
): UsageReportEmailSection {
  return {
    heading: 'Individual streak health',
    lines: [
      `Players: ${report.streakHealth.totalPlayers}`,
      `Current streak: ${formatHistogram(report.streakHealth.currentStreakHistogram)}`,
      `Longest streak ever: ${formatHistogram(report.streakHealth.longestStreakHistogram)}`,
    ],
    note: 'Histogram buckets only (ADR-0020 Decision 1) — never a list of individual streak values.',
  };
}

function activityRecencySection(
  report: UsageMetricsReport,
): UsageReportEmailSection {
  const recency = report.activityRecency;
  return {
    heading: 'Activity recency',
    lines: [
      `Trained in the last 7 days: ${recency.playersActiveLast7Days} of ${recency.totalPlayers} (${recency.percentActiveLast7Days}%)`,
      // Label derived from the window, never hardcoded "30" — the second
      // cutoff IS the report window, so a fixed string would silently start
      // lying the day USAGE_METRICS_WINDOW_DAYS changes.
      `Trained in the last ${report.windowDays} days: ${recency.playersActiveInWindow} of ${recency.totalPlayers} (${recency.percentActiveInWindow}%)`,
    ],
  };
}

function trainingTypeMixSection(
  report: UsageMetricsReport,
): UsageReportEmailSection {
  const lines = report.trainingTypeMix.map(
    (entry) =>
      `${entry.activityType}: ${entry.logCount} logs (${entry.percentOfLogs}%)`,
  );
  return {
    heading: 'Training-type mix',
    lines: lines.length > 0 ? lines : ['No training logged in this window.'],
  };
}

function weeklyGoalSection(
  report: UsageMetricsReport,
): UsageReportEmailSection {
  const { appWide } = report.weeklyGoalEngagement;
  return {
    heading: 'Weekly-goal engagement',
    lines: [
      `Goals that ran to the end of their window in this period: ${appWide.concludedGoalCount}`,
      `Met by the whole eligible roster: ${appWide.completedGoalCount} (${appWide.percentCompleted}%)`,
      `Cancelled before their end date (excluded from the rate above): ${appWide.cancelledGoalCount}`,
      ...teamSizeLines(report.weeklyGoalEngagement, weeklyGoalBucketLine),
    ],
    note: bucketNote(
      report.weeklyGoalEngagement,
      report.minTeamsPerBucket,
      '"Met" is ADR-0015\'s per-player definition (every eligible roster member individually reached the target, which is what awards the team bonus) — not a captain manually flipping the goal to "completed", which almost nobody does. Counts goals whose end date fell inside the window and strictly before today: a goal ending today still has hours left to be met. Draft goals never started and cancelled ones were abandoned, so neither is in the rate.',
    ),
  };
}

function weeklyGoalBucketLine(figures: WeeklyGoalBucketFigures): string {
  return `mean ${figures.meanTeamCompletionPercent}% of each team's own goals met`;
}

function teamPoolSection(report: UsageMetricsReport): UsageReportEmailSection {
  const growth = report.teamPoolGrowth;
  return {
    heading: 'Team pool (VM-Guld) growth',
    lines: [
      `Active pots: ${growth.activePotCount}`,
      `Median growth: ${growth.medianPointsPerWeek} points/week`,
      `Distribution: ${formatHistogram(growth.histogram)}`,
    ],
    note: 'Lifetime average since each season started (points_total / weeks elapsed), not points earned during this window — no points history is stored (Decision 6).',
  };
}

function socialUsageSection(
  report: UsageMetricsReport,
): UsageReportEmailSection {
  return {
    heading: 'Social features (counts only)',
    lines: [
      `Clip uploads per week: ${formatWeeklySeries(report.socialUsage.clipUploadsPerWeek)}`,
      `Chat messages per week: ${formatWeeklySeries(report.socialUsage.chatMessagesPerWeek)}`,
    ],
    note: 'Volume only — never which clip, never who posted, never message content. Weeks marked (partial) are only partly inside the window (the first and last always are), so their lower counts are windowing, not a real dip.',
  };
}

function badgeMixSection(report: UsageMetricsReport): UsageReportEmailSection {
  const lines = report.badgeMix.map(
    (entry) => `${entry.badgeKey ?? entry.badgeId}: ${entry.awardCount}`,
  );
  return {
    heading: 'Badge mix',
    lines: lines.length > 0 ? lines : ['No badges awarded in this window.'],
  };
}

// --- shared formatting -------------------------------------------------------

function teamSizeLines<TAppWide, TBucket>(
  metric: TeamSizeBucketedMetric<TAppWide, TBucket>,
  formatFigures: (figures: TBucket) => string,
): string[] {
  return metric.byTeamSizeBucket.map(
    (entry) =>
      `Teams with ${entry.bucket} eligible players (${entry.teamCount} teams): ${formatFigures(entry.figures)}`,
  );
}

function bucketNote<TAppWide, TBucket>(
  metric: TeamSizeBucketedMetric<TAppWide, TBucket>,
  minTeamsPerBucket: number,
  baseNote: string,
): string {
  const parts = [baseNote];
  if (metric.byTeamSizeBucket.length > 0) {
    parts.push(
      "Team-size lines are means across that bucket's teams (each team counts once, whatever its size), not totals — so they will not add up to the app-wide figures above.",
    );
  }
  if (metric.foldedIntoAppWide) {
    parts.push(
      metric.byTeamSizeBucket.length === 0
        ? `No team-size breakdown this period: no bucket reached the ${minTeamsPerBucket}-team minimum, so every team is counted in the app-wide figures above only (ADR-0020 Decision 3).`
        : `Some team-size buckets are not shown: they held fewer than ${minTeamsPerBucket} teams, so those teams are counted in the app-wide figures above only (ADR-0020 Decision 3). A missing bucket means "withheld", never "no teams".`,
    );
  }
  return parts.join(' ');
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function formatHistogram(bars: HistogramBar[]): string {
  return bars.map((bar) => `${bar.bucket}: ${bar.count}`).join(' | ');
}

function formatWeeklySeries(series: WeeklyCount[]): string {
  if (series.length === 0) return 'no data';
  return series
    .map(
      (week) =>
        `${week.weekStart}${week.partial ? ' (partial)' : ''}: ${week.count}`,
    )
    .join(' | ');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
