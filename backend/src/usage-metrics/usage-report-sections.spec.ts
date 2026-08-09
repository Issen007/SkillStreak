import { UsageMetricsReport } from './usage-metrics.types';
import { formatUsageReportSections } from './usage-report-sections';

function reportWith(
  overrides: Partial<UsageMetricsReport> = {},
): UsageMetricsReport {
  return {
    generatedAt: new Date('2026-08-01T06:00:00.000Z'),
    windowStart: new Date('2026-07-02T06:00:00.000Z'),
    windowDays: 30,
    minTeamsPerBucket: 5,
    totalTeams: 12,
    adoptionFunnel: {
      appWide: {
        totalPlayers: 57,
        playersByParentalConsentStatus: {
          not_requested: 0,
          pending: 4,
          approved: 51,
          revoked: 2,
        },
        playersByTeamJoinStatus: { pending: 3, approved: 53, rejected: 1 },
        playersWithAtLeastOneTrainingLog: 40,
        percentWithAtLeastOneTrainingLog: 70,
      },
      byTeamSizeBucket: [],
      foldedIntoAppWide: true,
    },
    streakHealth: {
      totalPlayers: 57,
      currentStreakHistogram: [
        { bucket: '0', count: 20 },
        { bucket: '31+', count: 1 },
      ],
      longestStreakHistogram: [{ bucket: '0', count: 10 }],
    },
    activityRecency: {
      totalPlayers: 57,
      playersActiveLast7Days: 20,
      percentActiveLast7Days: 35,
      playersActiveInWindow: 40,
      percentActiveInWindow: 70,
    },
    trainingTypeMix: [
      { activityType: 'drill' as never, logCount: 12, percentOfLogs: 60 },
    ],
    weeklyGoalEngagement: {
      appWide: {
        concludedGoalCount: 23,
        completedGoalCount: 16,
        percentCompleted: 70,
        cancelledGoalCount: 2,
      },
      byTeamSizeBucket: [],
      foldedIntoAppWide: true,
    },
    teamPoolGrowth: {
      activePotCount: 12,
      medianPointsPerWeek: 310.5,
      histogram: [{ bucket: '100-499', count: 12 }],
    },
    socialUsage: {
      clipUploadsPerWeek: [
        { weekStart: '2026-06-29', count: 1, partial: true },
        { weekStart: '2026-07-06', count: 3, partial: false },
      ],
      chatMessagesPerWeek: [
        { weekStart: '2026-07-06', count: 88, partial: false },
      ],
    },
    badgeMix: [{ badgeId: 'badge-1', badgeKey: 'best_effort', awardCount: 4 }],
    ...overrides,
  };
}

// docs/adr/0020-usage-analytics-product-metrics.md — what the project owner
// actually reads. Decision 3's floor has a presentation half: a suppressed
// breakdown must not look like missing data.
describe('formatUsageReportSections', () => {
  it('labels the run with its trailing window', () => {
    const input = formatUsageReportSections(reportWith());

    expect(input.generatedOn).toBe('2026-08-01');
    expect(input.windowLabel).toBe(
      'trailing 30 days, 2026-07-02 to 2026-08-01',
    );
  });

  it('renders all eight of Decision 1"s metrics, in a fixed order', () => {
    const { sections } = formatUsageReportSections(reportWith());

    expect(sections.map((section) => section.heading)).toEqual([
      'Adoption & consent funnel',
      'Individual streak health',
      'Activity recency',
      'Training-type mix',
      'Weekly-goal engagement',
      'Team pool (VM-Guld) growth',
      'Social features (counts only)',
      'Badge mix',
    ]);
  });

  it('explains a fully-suppressed team-size breakdown instead of leaving a silent gap', () => {
    const { sections } = formatUsageReportSections(reportWith());
    const funnel = sections[0];

    expect(funnel.lines.some((line) => line.includes('eligible players'))).toBe(
      false,
    );
    expect(funnel.note).toContain('No team-size breakdown this period');
    expect(funnel.note).toContain('5-team minimum');
  });

  // The case the first version of this file actively pinned the WRONG
  // behaviour for (code-critic finding): partial suppression is the common
  // shape at this app's scale — one bucket printed, the rest folded in —
  // and printing that one bucket with no explanation reads as "the other
  // buckets had no teams".
  it('explains a PARTIALLY-suppressed breakdown too, not only a fully-suppressed one', () => {
    const report = reportWith();
    report.adoptionFunnel.byTeamSizeBucket = [
      {
        bucket: '6+',
        teamCount: 6,
        figures: {
          meanPlayersPerTeam: 6,
          meanPercentConsentApproved: 100,
          meanPercentWithTrainingLog: 50,
        },
      },
    ];
    report.adoptionFunnel.foldedIntoAppWide = true;

    const funnel = formatUsageReportSections(report).sections[0];

    expect(funnel.lines).toContain(
      'Teams with 6+ eligible players (6 teams): mean 6 players/team, mean 100% consent-approved, mean 50% have logged training',
    );
    expect(funnel.note).toContain('Some team-size buckets are not shown');
    expect(funnel.note).toContain('never "no teams"');
    // ...and it says what kind of number a bucket line is.
    expect(funnel.note).toContain('means across');
  });

  it('says nothing about suppression when every bucket was printed', () => {
    const report = reportWith();
    report.adoptionFunnel.byTeamSizeBucket = [
      {
        bucket: '6+',
        teamCount: 6,
        figures: {
          meanPlayersPerTeam: 6,
          meanPercentConsentApproved: 100,
          meanPercentWithTrainingLog: 50,
        },
      },
    ];
    report.adoptionFunnel.foldedIntoAppWide = false;

    const funnel = formatUsageReportSections(report).sections[0];

    expect(funnel.note).not.toContain('not shown');
    expect(funnel.note).not.toContain('No team-size breakdown');
  });

  it('never prints the total team count, which is what would make the residual derivable', () => {
    const rendered = JSON.stringify(formatUsageReportSections(reportWith()));

    // reportWith() carries totalTeams: 12 — it must appear nowhere in the
    // rendered output (the shown buckets' own teamCounts are the only
    // team-level numbers a reader gets).
    expect(rendered).not.toContain('12 teams');
  });

  it('labels partial weeks so the window"s own edges do not read as a usage dip', () => {
    const social = formatUsageReportSections(reportWith()).sections[6];

    expect(social.lines[0]).toBe(
      'Clip uploads per week: 2026-06-29 (partial): 1 | 2026-07-06: 3',
    );
    expect(social.note).toContain('partial');
  });

  it('derives the recency label from the report window instead of hardcoding 30', () => {
    const { sections } = formatUsageReportSections(
      reportWith({ windowDays: 45 }),
    );

    expect(sections[2].lines[1]).toContain('last 45 days');
  });

  it('reports cancelled goals alongside the completion rate, never inside it', () => {
    const weeklyGoal = formatUsageReportSections(reportWith()).sections[4];

    expect(weeklyGoal.lines).toContain(
      'Cancelled before their end date (excluded from the rate above): 2',
    );
    // ...and the note says which definition of "met" produced the rate,
    // since the intuitive one (a captain marking the goal completed) is
    // explicitly NOT what's counted.
    expect(weeklyGoal.note).toContain('every eligible roster member');
    expect(weeklyGoal.note).toContain('not a captain manually flipping');
  });

  it('renders empty metrics as plain "nothing happened" copy rather than an empty section', () => {
    const { sections } = formatUsageReportSections(
      reportWith({ trainingTypeMix: [], badgeMix: [] }),
    );

    expect(sections[3].lines).toEqual(['No training logged in this window.']);
    expect(sections[7].lines).toEqual(['No badges awarded in this window.']);
  });
});
