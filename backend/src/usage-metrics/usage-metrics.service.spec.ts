import { Logger } from '@nestjs/common';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { ActivityType } from '../training-logs/activity-type.enum';
import {
  TeamGoalOutcomeRow,
  TeamStatusCountRow,
} from './usage-metrics.query.service';
import { UsageMetricsService } from './usage-metrics.service';

// docs/adr/0020-usage-analytics-product-metrics.md Decision 1's fixed
// allow-list and Decision 3's granularity rules, exercised end-to-end over
// the module's pure half: the query service is stubbed with
// already-aggregated rows (exactly what its real SQL returns), so these
// tests cover the aggregation/bucketing/floor logic without a database.
const NOW = new Date('2026-08-01T06:00:00.000Z');

function funnelRow(
  teamId: string,
  playerCount: number,
  playersWithAtLeastOneTrainingLog: number,
  parentalConsentStatus: ParentalConsentStatus = ParentalConsentStatus.APPROVED,
  teamJoinStatus: TeamJoinStatus = TeamJoinStatus.APPROVED,
): TeamStatusCountRow {
  return {
    teamId,
    parentalConsentStatus,
    teamJoinStatus,
    playerCount,
    playersWithAtLeastOneTrainingLog,
  };
}

function buildService(
  overrides: Partial<Record<string, jest.Mock>> = {},
  config: Record<string, string> = {},
) {
  const queryService = {
    queryAdoptionFunnelRows: jest.fn().mockResolvedValue([]),
    queryCurrentStreakValueCounts: jest.fn().mockResolvedValue([]),
    queryLongestStreakValueCounts: jest.fn().mockResolvedValue([]),
    queryActivityRecency: jest.fn().mockResolvedValue({
      totalPlayers: 0,
      playersActiveLast7Days: 0,
      playersActiveInWindow: 0,
    }),
    queryTrainingTypeMix: jest.fn().mockResolvedValue([]),
    queryWeeklyGoalOutcomeRows: jest.fn().mockResolvedValue([]),
    queryActivePotGrowthRows: jest.fn().mockResolvedValue([]),
    queryClipUploadsPerWeek: jest.fn().mockResolvedValue([]),
    queryChatMessagesPerWeek: jest.fn().mockResolvedValue([]),
    queryBadgeMix: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  };

  const service = new UsageMetricsService(
    configService as never,
    queryService as never,
  );

  return { service, queryService, configService };
}

describe('UsageMetricsService.collect', () => {
  it('stamps the run with its trailing window and the floor actually applied', async () => {
    const { service } = buildService();

    const report = await service.collect(NOW);

    expect(report.generatedAt).toEqual(NOW);
    expect(report.windowDays).toBe(30);
    expect(report.windowStart).toEqual(new Date('2026-07-02T06:00:00.000Z'));
    expect(report.minTeamsPerBucket).toBe(5);
  });

  it('is empty-safe on a brand-new database (no players, no logs, no teams)', async () => {
    const { service } = buildService();

    const report = await service.collect(NOW);

    expect(report.totalTeams).toBe(0);
    expect(report.adoptionFunnel.appWide.totalPlayers).toBe(0);
    expect(report.adoptionFunnel.appWide.percentWithAtLeastOneTrainingLog).toBe(
      0,
    );
    expect(report.adoptionFunnel.byTeamSizeBucket).toEqual([]);
    expect(report.activityRecency.percentActiveLast7Days).toBe(0);
    expect(report.trainingTypeMix).toEqual([]);
    expect(report.badgeMix).toEqual([]);
  });

  // --- Metric 1 --------------------------------------------------------------
  it('builds the app-wide adoption funnel with every consent/join status present, including zeros', async () => {
    const { service } = buildService({
      queryAdoptionFunnelRows: jest
        .fn()
        .mockResolvedValue([
          funnelRow('team-a', 4, 3),
          funnelRow(
            'team-a',
            2,
            0,
            ParentalConsentStatus.PENDING,
            TeamJoinStatus.PENDING,
          ),
          funnelRow(
            'team-b',
            1,
            1,
            ParentalConsentStatus.REVOKED,
            TeamJoinStatus.APPROVED,
          ),
        ]),
    });

    const { appWide } = (await service.collect(NOW)).adoptionFunnel;

    expect(appWide.totalPlayers).toBe(7);
    expect(appWide.playersByParentalConsentStatus).toEqual({
      not_requested: 0,
      pending: 2,
      approved: 4,
      revoked: 1,
    });
    expect(appWide.playersByTeamJoinStatus).toEqual({
      pending: 2,
      approved: 5,
      rejected: 0,
    });
    expect(appWide.playersWithAtLeastOneTrainingLog).toBe(4);
    expect(appWide.percentWithAtLeastOneTrainingLog).toBe(57);
  });

  // --- Metric 2 --------------------------------------------------------------
  it('reports both streak histograms and the player total they cover', async () => {
    const { service } = buildService({
      queryCurrentStreakValueCounts: jest.fn().mockResolvedValue([
        { streakCount: 0, playerCount: 5 },
        { streakCount: 9, playerCount: 2 },
      ]),
      queryLongestStreakValueCounts: jest
        .fn()
        .mockResolvedValue([{ streakCount: 40, playerCount: 7 }]),
    });

    const { streakHealth } = await service.collect(NOW);

    expect(streakHealth.totalPlayers).toBe(7);
    expect(streakHealth.currentStreakHistogram).toEqual([
      { bucket: '0', count: 5 },
      { bucket: '1-3', count: 0 },
      { bucket: '4-7', count: 0 },
      { bucket: '8-14', count: 2 },
      { bucket: '15-30', count: 0 },
      { bucket: '31+', count: 0 },
    ]);
    expect(
      streakHealth.longestStreakHistogram.find((bar) => bar.bucket === '31+'),
    ).toEqual({ bucket: '31+', count: 7 });
  });

  // --- Metric 3 --------------------------------------------------------------
  it('turns the trailing 7-day/window active counts into percentages, and passes both cutoffs to the query', async () => {
    const { service, queryService } = buildService({
      queryActivityRecency: jest.fn().mockResolvedValue({
        totalPlayers: 20,
        playersActiveLast7Days: 5,
        playersActiveInWindow: 15,
      }),
    });

    const { activityRecency } = await service.collect(NOW);

    expect(activityRecency.percentActiveLast7Days).toBe(25);
    expect(activityRecency.percentActiveInWindow).toBe(75);
    expect(queryService.queryActivityRecency).toHaveBeenCalledWith(
      new Date('2026-07-25T06:00:00.000Z'),
      new Date('2026-07-02T06:00:00.000Z'),
    );
  });

  // --- Metric 4 --------------------------------------------------------------
  it('reports the training-type mix as counts plus share, most-used first', async () => {
    const { service, queryService } = buildService({
      queryTrainingTypeMix: jest.fn().mockResolvedValue([
        { activityType: ActivityType.DRILL, logCount: 10 },
        { activityType: ActivityType.RUNNING, logCount: 30 },
      ]),
    });

    const report = await service.collect(NOW);

    expect(report.trainingTypeMix).toEqual([
      { activityType: ActivityType.RUNNING, logCount: 30, percentOfLogs: 75 },
      { activityType: ActivityType.DRILL, logCount: 10, percentOfLogs: 25 },
    ]);
    expect(queryService.queryTrainingTypeMix).toHaveBeenCalledWith(
      new Date('2026-07-02T06:00:00.000Z'),
    );
  });

  // --- Metric 5 --------------------------------------------------------------
  it('reports weekly-goal engagement as met-of-concluded, with cancellations alongside rather than inside the rate', async () => {
    const { service, queryService } = buildService({
      queryWeeklyGoalOutcomeRows: jest.fn().mockResolvedValue([
        {
          teamId: 'team-a',
          concludedGoalCount: 4,
          completedGoalCount: 3,
          cancelledGoalCount: 1,
        },
        {
          teamId: 'team-b',
          concludedGoalCount: 4,
          completedGoalCount: 1,
          cancelledGoalCount: 0,
        },
      ] satisfies TeamGoalOutcomeRow[]),
    });

    const { appWide } = (await service.collect(NOW)).weeklyGoalEngagement;

    expect(appWide).toEqual({
      concludedGoalCount: 8,
      completedGoalCount: 4,
      percentCompleted: 50,
      cancelledGoalCount: 1,
    });
    // The second date is today, and the query treats it as EXCLUSIVE — a
    // goal ending today still has hours left to be met.
    expect(queryService.queryWeeklyGoalOutcomeRows).toHaveBeenCalledWith(
      '2026-07-02',
      '2026-08-01',
    );
  });

  // --- Metric 6 --------------------------------------------------------------
  it('reports team-pool growth as a distribution across active pots', async () => {
    const { service } = buildService({
      queryActivePotGrowthRows: jest.fn().mockResolvedValue([
        { pointsTotal: 400, seasonStartDate: '2026-07-04' },
        { pointsTotal: 800, seasonStartDate: '2026-07-04' },
      ]),
    });

    const { teamPoolGrowth } = await service.collect(NOW);

    expect(teamPoolGrowth.activePotCount).toBe(2);
    // 4 weeks + 6h elapsed since the season started, so ~99.1 and ~198.2
    // points/week; the median is their average, rounded to one decimal.
    expect(teamPoolGrowth.medianPointsPerWeek).toBe(148.7);
  });

  // --- Metric 7 --------------------------------------------------------------
  it('reports clip/chat volume as a continuous weekly series, counts only', async () => {
    const { service } = buildService({
      queryClipUploadsPerWeek: jest
        .fn()
        .mockResolvedValue([{ weekStart: '2026-07-13', count: 6 }]),
      queryChatMessagesPerWeek: jest
        .fn()
        .mockResolvedValue([{ weekStart: '2026-07-13', count: 41 }]),
    });

    const { socialUsage } = await service.collect(NOW);

    expect(socialUsage.clipUploadsPerWeek).toHaveLength(5);
    expect(socialUsage.clipUploadsPerWeek).toContainEqual({
      weekStart: '2026-07-13',
      count: 6,
      partial: false,
    });
    expect(socialUsage.chatMessagesPerWeek).toContainEqual({
      weekStart: '2026-07-13',
      count: 41,
      partial: false,
    });
    // Every entry is a week, a number and the partial flag — no ids, no
    // content.
    for (const entry of socialUsage.chatMessagesPerWeek) {
      expect(Object.keys(entry).sort()).toEqual([
        'count',
        'partial',
        'weekStart',
      ]);
    }
  });

  // --- Metric 8 --------------------------------------------------------------
  it('reports badge awards grouped by badge, most-awarded first, with the catalog key for readability', async () => {
    const { service } = buildService({
      queryBadgeMix: jest.fn().mockResolvedValue([
        { badgeId: 'badge-1', badgeKey: 'best_effort', awardCount: 2 },
        { badgeId: 'badge-2', badgeKey: 'streak_7', awardCount: 9 },
      ]),
    });

    const { badgeMix } = await service.collect(NOW);

    expect(badgeMix).toEqual([
      { badgeId: 'badge-2', badgeKey: 'streak_7', awardCount: 9 },
      { badgeId: 'badge-1', badgeKey: 'best_effort', awardCount: 2 },
    ]);
  });

  // --- Decision 3: team-size bucketing + the minimum-population floor ---------
  describe('team-size bucketing (Decision 3)', () => {
    // 6 teams of 6 eligible players ('6+'), 5 teams of 4 ('3-5'), 1 team of
    // 1 ('1-2') — 12 teams, 57 players.
    function realisticFunnelRows(): TeamStatusCountRow[] {
      return [
        ...Array.from({ length: 6 }, (_, i) => funnelRow(`big-${i}`, 6, 3)),
        ...Array.from({ length: 5 }, (_, i) => funnelRow(`mid-${i}`, 4, 2)),
        funnelRow('tiny-0', 1, 0),
      ];
    }

    it('never breaks out a bucket holding fewer teams than the floor; those teams stay in the app-wide number', async () => {
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue(realisticFunnelRows()),
      });

      const report = await service.collect(NOW);
      const { appWide, byTeamSizeBucket } = report.adoptionFunnel;

      // The single '1-2' team is below the floor of 5 and is absent from
      // the breakdown — no placeholder row, no zeroed bucket, no gap.
      expect(byTeamSizeBucket.map((entry) => entry.bucket)).not.toContain(
        '1-2',
      );
      // ...but its player is still counted app-wide (36 + 20 + 1).
      expect(appWide.totalPlayers).toBe(57);
      expect(report.totalTeams).toBe(12);
    });

    it('reports a bucket that meets the floor as team-weighted means, never pooled totals', async () => {
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue(realisticFunnelRows()),
      });

      const report = await service.collect(NOW);

      // '6+' holds 6 teams >= the floor of 5, so it is reported. ('3-5'
      // holds exactly 5 and clears the floor on its own, but is dropped by
      // complementary suppression — printing it alongside '6+' and the
      // app-wide total would expose the suppressed single-team bucket by
      // subtraction. See applyMinimumPopulationFloor.)
      expect(report.adoptionFunnel.byTeamSizeBucket).toEqual([
        {
          bucket: '6+',
          teamCount: 6,
          // Each of the six teams: 6 players, all consent-approved, 3 with
          // a training log. Means, not the 36/18 pooled totals — a single
          // 40-player team could otherwise define a whole bucket.
          figures: {
            meanPlayersPerTeam: 6,
            meanPercentConsentApproved: 100,
            meanPercentWithTrainingLog: 50,
          },
        },
      ]);
      expect(report.adoptionFunnel.foldedIntoAppWide).toBe(true);
    });

    it('weights each team equally inside a bucket, so one big team cannot define it', async () => {
      // Exactly the case code-critic named: buckets are keyed on ELIGIBLE
      // players, so a 40-member team whose players are all still
      // consent-pending has 0 eligible and lands in '1-2' beside four
      // genuinely tiny teams. Pooled, that bucket would read 40/44 = 91%
      // "have logged training" — one team's number wearing a five-team
      // bucket's clothes. Team-weighted, it reads 20%.
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue([
            ...Array.from({ length: 4 }, (_, i) =>
              funnelRow(`tiny-${i}`, 1, 0),
            ),
            funnelRow(
              'huge-0',
              40,
              40,
              ParentalConsentStatus.PENDING,
              TeamJoinStatus.PENDING,
            ),
          ]),
      });

      const { byTeamSizeBucket } = (await service.collect(NOW)).adoptionFunnel;

      expect(byTeamSizeBucket).toEqual([
        {
          bucket: '1-2',
          teamCount: 5,
          figures: {
            meanPlayersPerTeam: 8.8,
            meanPercentConsentApproved: 80,
            meanPercentWithTrainingLog: 20,
          },
        },
      ]);
    });

    it('breaks out every bucket when each one clears the floor with no residual', async () => {
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue([
            ...Array.from({ length: 5 }, (_, i) =>
              funnelRow(`tiny-${i}`, 2, 1),
            ),
            ...Array.from({ length: 5 }, (_, i) => funnelRow(`big-${i}`, 8, 4)),
          ]),
      });

      const { byTeamSizeBucket } = (await service.collect(NOW)).adoptionFunnel;

      expect(
        byTeamSizeBucket.map((entry) => [entry.bucket, entry.teamCount]),
      ).toEqual([
        ['1-2', 5],
        ['6+', 5],
      ]);
    });

    it('applies the same floor to weekly-goal engagement, keying it on the teams whose goals are actually counted', async () => {
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue(realisticFunnelRows()),
        queryWeeklyGoalOutcomeRows: jest.fn().mockResolvedValue([
          ...Array.from({ length: 6 }, (_, i) => ({
            teamId: `big-${i}`,
            concludedGoalCount: 2,
            completedGoalCount: 1,
            cancelledGoalCount: 0,
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            teamId: `mid-${i}`,
            concludedGoalCount: 2,
            completedGoalCount: 2,
            cancelledGoalCount: 0,
          })),
          {
            teamId: 'tiny-0',
            concludedGoalCount: 1,
            completedGoalCount: 0,
            cancelledGoalCount: 3,
          },
        ] satisfies TeamGoalOutcomeRow[]),
      });

      const { appWide, byTeamSizeBucket } = (await service.collect(NOW))
        .weeklyGoalEngagement;

      // Every team's goals count app-wide, including the suppressed ones.
      expect(appWide).toEqual({
        concludedGoalCount: 23,
        completedGoalCount: 16,
        percentCompleted: 70,
        cancelledGoalCount: 3,
      });
      // Only '6+' survives, for the same reason as the funnel above — and
      // it reports the mean of its six teams' own rates (each 1 of 2), not
      // the pooled 6-of-12.
      expect(byTeamSizeBucket).toEqual([
        {
          bucket: '6+',
          teamCount: 6,
          figures: { meanTeamCompletionPercent: 50 },
        },
      ]);
    });

    it('weights each team equally inside a weekly-goal bucket, so a captain who ran eight goals cannot define it', async () => {
      // Five '6+' teams: one ran 8 goals and met them all, four ran 1 each
      // and met none. Pooled, that bucket reads 8/12 = 67%. Team-weighted,
      // it reads 20% — and a '1-2'-sized version of this shape is at most
      // two children's behaviour, which is what the floor is supposed to be
      // binding on.
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue(
            Array.from({ length: 5 }, (_, i) => funnelRow(`big-${i}`, 9, 9)),
          ),
        queryWeeklyGoalOutcomeRows: jest.fn().mockResolvedValue([
          {
            teamId: 'big-0',
            concludedGoalCount: 8,
            completedGoalCount: 8,
            cancelledGoalCount: 0,
          },
          ...Array.from({ length: 4 }, (_, i) => ({
            teamId: `big-${i + 1}`,
            concludedGoalCount: 1,
            completedGoalCount: 0,
            cancelledGoalCount: 0,
          })),
        ] satisfies TeamGoalOutcomeRow[]),
      });

      const { appWide, byTeamSizeBucket } = (await service.collect(NOW))
        .weeklyGoalEngagement;

      // App-wide stays a pooled rate, deliberately (it's not stratified, so
      // there's no bucket for one team to dominate).
      expect(appWide.percentCompleted).toBe(67);
      expect(byTeamSizeBucket).toEqual([
        {
          bucket: '6+',
          teamCount: 5,
          figures: { meanTeamCompletionPercent: 20 },
        },
      ]);
    });

    it('suppresses the whole breakdown at real beta scale (a handful of teams), which is the expected case, not an error', async () => {
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue([
            funnelRow('team-a', 9, 5),
            funnelRow('team-b', 7, 2),
            funnelRow('team-c', 2, 1),
          ]),
      });

      const report = await service.collect(NOW);

      expect(report.adoptionFunnel.byTeamSizeBucket).toEqual([]);
      expect(report.weeklyGoalEngagement.byTeamSizeBucket).toEqual([]);
      expect(report.adoptionFunnel.appWide.totalPlayers).toBe(18);
    });

    it('buckets a team whose players are all still consent-pending as "1-2" (zero ELIGIBLE players), never drops it', async () => {
      const { service } = buildService({
        queryAdoptionFunnelRows: jest
          .fn()
          .mockResolvedValue([
            ...Array.from({ length: 5 }, (_, i) =>
              funnelRow(
                `pending-${i}`,
                9,
                0,
                ParentalConsentStatus.PENDING,
                TeamJoinStatus.PENDING,
              ),
            ),
            ...Array.from({ length: 5 }, (_, i) => funnelRow(`big-${i}`, 9, 9)),
          ]),
      });

      const { byTeamSizeBucket } = (await service.collect(NOW)).adoptionFunnel;

      expect(
        byTeamSizeBucket.map((entry) => [entry.bucket, entry.teamCount]),
      ).toEqual([
        ['1-2', 5],
        ['6+', 5],
      ]);
    });
  });

  // --- Decision 3's floor as a config value -----------------------------------
  describe('USAGE_REPORT_MIN_TEAMS_PER_BUCKET', () => {
    const tenTeams = Array.from({ length: 10 }, (_, i) =>
      funnelRow(`big-${i}`, 8, 4),
    );

    it('honours a raised floor', async () => {
      const { service } = buildService(
        {
          queryAdoptionFunnelRows: jest.fn().mockResolvedValue(tenTeams),
        },
        { USAGE_REPORT_MIN_TEAMS_PER_BUCKET: '25' },
      );

      const report = await service.collect(NOW);

      expect(report.minTeamsPerBucket).toBe(25);
      expect(report.adoptionFunnel.byTeamSizeBucket).toEqual([]);
    });

    // security-reviewer's hardening ask: the clamp alone made 2/3/4 silently
    // acceptable even though the reviewed floor is N >= 5, so anything below
    // the ADR's own recommendation has to be said out loud every run.
    it('warns whenever the configured floor is below the reviewed default, even when it is legal', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const { service } = buildService(
          { queryAdoptionFunnelRows: jest.fn().mockResolvedValue(tenTeams) },
          { USAGE_REPORT_MIN_TEAMS_PER_BUCKET: '3' },
        );

        // Honoured (it's above the hard minimum of 2)...
        expect((await service.collect(NOW)).minTeamsPerBucket).toBe(3);
        // ...but never silently.
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("below ADR-0020 Decision 3's reviewed floor"),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn at the reviewed default or above', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const { service } = buildService(
          { queryAdoptionFunnelRows: jest.fn().mockResolvedValue(tenTeams) },
          { USAGE_REPORT_MIN_TEAMS_PER_BUCKET: '5' },
        );

        await service.collect(NOW);

        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('refuses a floor of 1 — the degenerate single-team bucket the floor exists to prevent', async () => {
      const { service } = buildService(
        { queryAdoptionFunnelRows: jest.fn().mockResolvedValue(tenTeams) },
        { USAGE_REPORT_MIN_TEAMS_PER_BUCKET: '1' },
      );

      expect((await service.collect(NOW)).minTeamsPerBucket).toBe(2);
    });

    it('falls back to the default on a non-numeric or empty value rather than failing the run', async () => {
      const nonsense = buildService(
        {},
        {
          USAGE_REPORT_MIN_TEAMS_PER_BUCKET: 'lots',
        },
      );
      const empty = buildService({}, { USAGE_REPORT_MIN_TEAMS_PER_BUCKET: '' });

      expect((await nonsense.service.collect(NOW)).minTeamsPerBucket).toBe(5);
      expect((await empty.service.collect(NOW)).minTeamsPerBucket).toBe(5);
    });
  });
});
