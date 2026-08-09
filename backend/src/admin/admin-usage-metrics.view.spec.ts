import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { ActivityType } from '../training-logs/activity-type.enum';
import { UsageMetricsReport } from '../usage-metrics/usage-metrics.types';
import { toAdminUsageMetricsResponse } from './admin-usage-metrics.view';

function buildReport(
  overrides: Partial<UsageMetricsReport> = {},
): UsageMetricsReport {
  return {
    generatedAt: new Date('2026-08-07T06:12:00.000Z'),
    windowStart: new Date('2026-07-08T06:12:00.000Z'),
    windowDays: 30,
    minTeamsPerBucket: 5,
    totalTeams: 11,
    adoptionFunnel: {
      appWide: {
        totalPlayers: 142,
        playersByParentalConsentStatus: {
          [ParentalConsentStatus.NOT_REQUESTED]: 15,
          [ParentalConsentStatus.PENDING]: 28,
          [ParentalConsentStatus.APPROVED]: 96,
          [ParentalConsentStatus.REVOKED]: 3,
        },
        playersByTeamJoinStatus: {
          [TeamJoinStatus.PENDING]: 27,
          [TeamJoinStatus.APPROVED]: 110,
          [TeamJoinStatus.REJECTED]: 5,
        },
        playersWithAtLeastOneTrainingLog: 88,
        percentWithAtLeastOneTrainingLog: 62,
      },
      byTeamSizeBucket: [
        {
          bucket: '6+',
          teamCount: 9,
          figures: {
            meanPlayersPerTeam: 8.6,
            meanPercentConsentApproved: 79,
            meanPercentWithTrainingLog: 66,
          },
        },
      ],
      foldedIntoAppWide: true,
    },
    streakHealth: {
      totalPlayers: 142,
      currentStreakHistogram: [{ bucket: '0', count: 41 }],
      longestStreakHistogram: [{ bucket: '0', count: 12 }],
    },
    activityRecency: {
      totalPlayers: 142,
      playersActiveLast7Days: 82,
      percentActiveLast7Days: 58,
      playersActiveInWindow: 105,
      percentActiveInWindow: 74,
    },
    trainingTypeMix: [
      {
        activityType: ActivityType.DRILL,
        logCount: 412,
        percentOfLogs: 44,
      },
    ],
    weeklyGoalEngagement: {
      appWide: {
        concludedGoalCount: 34,
        completedGoalCount: 19,
        percentCompleted: 56,
        cancelledGoalCount: 6,
      },
      byTeamSizeBucket: [],
      foldedIntoAppWide: false,
    },
    teamPoolGrowth: {
      activePotCount: 11,
      medianPointsPerWeek: 385,
      histogram: [{ bucket: '100-499', count: 5 }],
    },
    socialUsage: {
      clipUploadsPerWeek: [
        { weekStart: '2026-07-06', count: 4, partial: true },
      ],
      chatMessagesPerWeek: [
        { weekStart: '2026-07-06', count: 9, partial: true },
      ],
    },
    badgeMix: [{ badgeId: 'badge-uuid', badgeKey: 'streak_7', awardCount: 63 }],
    ...overrides,
  };
}

// docs/adr/0022-admin-control-center.md Decisions 4/5 +
// docs/design/phase7-admin-console-flows.md §4.1/§13.
describe('toAdminUsageMetricsResponse', () => {
  // The security property of this whole file, tested rather than reviewed:
  // printing totalTeams alongside each visible bucket's teamCount is exactly
  // the residual arithmetic ADR-0020 Decision 3's minimum-population floor
  // exists to prevent, and §13 requires it be structurally absent from the
  // DTO, "not merely not rendered".
  it('omits totalTeams structurally — the key does not exist on the response', () => {
    const response = toAdminUsageMetricsResponse(buildReport());

    expect('totalTeams' in response).toBe(false);
    expect(Object.keys(response)).not.toContain('totalTeams');
    // And it survives the actual serialization the browser sees, not just
    // the in-memory object.
    expect(JSON.parse(JSON.stringify(response))).not.toHaveProperty(
      'totalTeams',
    );
  });

  // A spread (`{ ...report }`) would pass the assertion above only until
  // someone deleted the delete. This pins the allow-list behaviour itself:
  // a field added to UsageMetricsReport for the monthly email's own purposes
  // must not appear on the admin endpoint by default.
  it('does not forward an unknown future field added to the report', () => {
    const report = buildReport() as UsageMetricsReport & {
      futureInternalField: string;
    };
    report.futureInternalField = 'should never reach the browser';

    expect(toAdminUsageMetricsResponse(report)).not.toHaveProperty(
      'futureInternalField',
    );
  });

  // §4.4 state B vs. state C/D: without foldedIntoAppWide the console cannot
  // tell "a breakdown was withheld" from "there are no teams", and without
  // minTeamsPerBucket its copy would have to hardcode 5, which starts lying
  // the day USAGE_REPORT_MIN_TEAMS_PER_BUCKET is raised.
  it('carries minTeamsPerBucket and every metric’s foldedIntoAppWide', () => {
    const response = toAdminUsageMetricsResponse(buildReport());

    expect(response.minTeamsPerBucket).toBe(5);
    expect(response.adoptionFunnel.foldedIntoAppWide).toBe(true);
    expect(response.weeklyGoalEngagement.foldedIntoAppWide).toBe(false);
  });

  // Decision 5's structural floor, asserted against the serialized payload
  // rather than the type: no team or player identifier anywhere, at any
  // depth. A bucketed metric carries only the bucket label and a
  // floor-checked aggregate.
  it('contains no teamId/playerId/screenName/teamName anywhere in the payload', () => {
    const serialized = JSON.stringify(
      toAdminUsageMetricsResponse(buildReport()),
    );

    for (const forbidden of [
      'teamId',
      'playerId',
      'screenName',
      'teamName',
      'realName',
      'parentContact',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('serializes the two report timestamps as ISO-8601 strings', () => {
    const response = toAdminUsageMetricsResponse(buildReport());

    expect(response.generatedAt).toBe('2026-08-07T06:12:00.000Z');
    expect(response.windowStart).toBe('2026-07-08T06:12:00.000Z');
  });
});
