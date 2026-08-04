import { PtConsentNotApprovedException } from '../common/errors/exceptions';
import { ActivityType } from '../training-logs/activity-type.enum';
import { ChallengeStatus } from '../challenges/entities/challenge.entity';
import { PtPlayerConsentStatus } from './entities/pt-player-consent.entity';
import { PtDataService } from './pt-data.service';

function buildService(overrides: {
  teamPoolService?: Record<string, jest.Mock>;
  weeklyGoalService?: Record<string, jest.Mock>;
  ptTeamLinkRepository?: Record<string, jest.Mock>;
  ptPlayerConsentRepository?: Record<string, jest.Mock>;
  teamRepository?: Record<string, jest.Mock>;
  playerRepository?: Record<string, jest.Mock>;
  challengeRepository?: Record<string, jest.Mock>;
  trainingLogEntryRepository?: Record<string, jest.Mock>;
  badgeRepository?: Record<string, jest.Mock>;
  badgeAwardRepository?: Record<string, jest.Mock>;
}) {
  const teamPoolService = {
    getActivePotForTeam: jest
      .fn()
      .mockResolvedValue({ pointsTotal: 100, goalThreshold: 500 }),
    ...overrides.teamPoolService,
  };
  const weeklyGoalService = {
    computeTeamProgress: jest.fn().mockResolvedValue(42),
    ...overrides.weeklyGoalService,
  };
  const ptTeamLinkRepository = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: 'link-1', teamId: 'team-1', ptStaffAccountId: 'pt-1' },
      ]),
    ...overrides.ptTeamLinkRepository,
  };
  const ptPlayerConsentRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides.ptPlayerConsentRepository,
  };
  const teamRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 'team-1', name: 'IBK Falken' }),
    ...overrides.teamRepository,
  };
  const playerRepository = {
    find: jest.fn().mockResolvedValue([
      { id: 'player-1', screenName: 'FloorballStar15' },
      { id: 'player-2', screenName: 'IceHawk' },
    ]),
    findOne: jest.fn().mockResolvedValue({
      id: 'player-1',
      screenName: 'FloorballStar15',
      currentStreakCount: 5,
      longestStreakCount: 12,
      lastTrainedDate: '2026-08-01',
    }),
    ...overrides.playerRepository,
  };
  const challengeRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides.challengeRepository,
  };
  const trainingLogEntryRepository = {
    find: jest.fn().mockResolvedValue([
      {
        loggedAt: new Date('2026-08-01T10:00:00.000Z'),
        activityType: ActivityType.DRILL,
        durationMinutes: 30,
      },
    ]),
    ...overrides.trainingLogEntryRepository,
  };
  const badgeRepository = {
    find: jest
      .fn()
      .mockResolvedValue([
        { id: 'badge-1', key: 'best_effort', displayName: 'Best Effort' },
      ]),
    ...overrides.badgeRepository,
  };
  const badgeAwardRepository = {
    find: jest.fn().mockResolvedValue([
      {
        badgeId: 'badge-1',
        awardedAt: new Date('2026-07-15T00:00:00.000Z'),
        awardedBy: 'system',
        context: { triggerReason: 'streak_milestone', note: 'a secret note' },
      },
    ]),
    ...overrides.badgeAwardRepository,
  };

  const service = new PtDataService(
    teamPoolService as never,
    weeklyGoalService as never,
    ptTeamLinkRepository as never,
    ptPlayerConsentRepository as never,
    teamRepository as never,
    playerRepository as never,
    challengeRepository as never,
    trainingLogEntryRepository as never,
    badgeRepository as never,
    badgeAwardRepository as never,
  );

  return {
    service,
    teamPoolService,
    weeklyGoalService,
    ptTeamLinkRepository,
    ptPlayerConsentRepository,
    teamRepository,
    playerRepository,
    challengeRepository,
    trainingLogEntryRepository,
    badgeRepository,
    badgeAwardRepository,
  };
}

describe('PtDataService.getTeamAggregateViewsForPt', () => {
  it('shows the live current roster with each player’s consent status, no per-player training data', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        find: jest
          .fn()
          .mockResolvedValue([
            { playerId: 'player-1', status: PtPlayerConsentStatus.APPROVED },
          ]),
      },
    });

    const [view] = await service.getTeamAggregateViewsForPt('pt-1');

    expect(view.teamName).toBe('IBK Falken');
    expect(view.teamPool).toEqual({ pointsTotal: 100, goalThreshold: 500 });
    expect(view.roster).toEqual([
      {
        playerId: 'player-1',
        screenName: 'FloorballStar15',
        consentStatus: 'approved',
      },
      { playerId: 'player-2', screenName: 'IceHawk', consentStatus: 'none' },
    ]);
    expect(view.rosterSize).toBe(2);
    // Structurally cannot leak training data — nothing in this shape has a
    // streak/training-log/badge field.
    expect(view).not.toHaveProperty('trainingLog');
    expect(view).not.toHaveProperty('currentStreakCount');
  });

  it('includes the active weekly goal and its live team-wide progress when one exists', async () => {
    const { service, challengeRepository, weeklyGoalService } = buildService({
      challengeRepository: {
        findOne: jest.fn().mockResolvedValue({
          title: 'Veckans mål',
          description: '...',
          targetMetric: 'total-minuter',
          targetValue: 300,
          startDate: '2026-08-01',
          endDate: '2026-08-07',
          status: ChallengeStatus.ACTIVE,
        }),
      },
    });

    const [view] = await service.getTeamAggregateViewsForPt('pt-1');

    expect(challengeRepository.findOne).toHaveBeenCalled();
    expect(weeklyGoalService.computeTeamProgress).toHaveBeenCalledWith(
      undefined,
      'team-1',
      'total-minuter',
      '2026-08-01',
      '2026-08-07',
    );
    expect(view.activeWeeklyGoal).toEqual(
      expect.objectContaining({ title: 'Veckans mål', teamProgressValue: 42 }),
    );
  });
});

describe('PtDataService.getPlayerTrainingData', () => {
  it('refuses with pt_consent_not_approved when no live approved consent exists', async () => {
    const { service } = buildService({});
    await expect(
      service.getPlayerTrainingData('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtConsentNotApprovedException);
  });

  it('returns exactly the allow-listed fields — badge.context (including its note) is never included', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'consent-1',
          status: PtPlayerConsentStatus.APPROVED,
        }),
      },
    });

    const view = await service.getPlayerTrainingData('pt-1', 'player-1');

    expect(view.screenName).toBe('FloorballStar15');
    expect(view.currentStreakCount).toBe(5);
    expect(view.longestStreakCount).toBe(12);
    expect(view.lastTrainedDate).toBe('2026-08-01');
    expect(view.trainingLog).toEqual([
      {
        loggedAt: '2026-08-01T10:00:00.000Z',
        activityType: ActivityType.DRILL,
        durationMinutes: 30,
      },
    ]);
    expect(view.badges).toEqual([
      {
        key: 'best_effort',
        displayName: 'Best Effort',
        awardedAt: '2026-07-15T00:00:00.000Z',
      },
    ]);
    // Never real_name/parent_contact, never chat/video, never another PT's
    // relationships, and — the security-review Finding 7 fix — never
    // badge.context (including its freeform `note` subfield).
    for (const badge of view.badges) {
      expect(badge).not.toHaveProperty('context');
      expect(badge).not.toHaveProperty('note');
      expect(Object.keys(badge).sort()).toEqual([
        'awardedAt',
        'displayName',
        'key',
      ]);
    }
    expect(view).not.toHaveProperty('realName');
    expect(view).not.toHaveProperty('parentContact');
  });
});
