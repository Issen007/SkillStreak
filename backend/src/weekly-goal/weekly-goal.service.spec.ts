import { EntityManager } from 'typeorm';
import { ActivityType } from '../training-logs/activity-type.enum';
import { ChallengeStatus } from '../challenges/entities/challenge.entity';
import {
  ChallengeAlreadyTerminalException,
  ChallengeTargetFrozenException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { Player } from '../players/entities/player.entity';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { WeeklyGoalTargetMetric } from './weekly-goal-target-metric.enum';
import { WeeklyGoalService } from './weekly-goal.service';
import { EffortLeaderboardRow } from '../team-pool/team-pool.service';

// Chainable fake query builder — every method returns `this` except the
// terminal ones (getOne/getRawOne/getRawMany/getMany), which are
// configurable per test. Mirrors the subset of TypeORM's QueryBuilder API
// WeeklyGoalService actually calls.
function makeQueryBuilder(terminal: {
  getOne?: unknown;
  getRawOne?: unknown;
  getRawMany?: unknown[];
}) {
  const qb: Record<string, jest.Mock> = {};
  const chain = [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'setLock',
    'groupBy',
  ];
  for (const method of chain) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getOne = jest.fn().mockResolvedValue(terminal.getOne ?? null);
  qb.getRawOne = jest.fn().mockResolvedValue(terminal.getRawOne ?? null);
  qb.getRawMany = jest.fn().mockResolvedValue(terminal.getRawMany ?? []);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb;
}

// A minimal, ADR-0015-eligible Player row (approved consent, approved team
// join, joined well before any test goal's startDate). `overrides` is how
// individual tests punch a hole in one of those three eligibility
// conditions, or change identity fields.
function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    teamId: 'team-1',
    screenName: `Player-${id}`,
    avatarId: 'avatar-1',
    birthYear: 2014,
    parentalConsentStatus: ParentalConsentStatus.APPROVED,
    teamJoinStatus: TeamJoinStatus.APPROVED,
    currentStreakCount: 0,
    longestStreakCount: 0,
    lastTrainedDate: null,
    bankedStreakSaverCount: 0,
    consentToken: null,
    consentTokenExpiresAt: null,
    isCaptain: false,
    tokenVersion: 0,
    sessionReissueCode: null,
    sessionReissueCodeExpiresAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    locale: PlayerLocale.SV,
    ...overrides,
  };
}

describe('WeeklyGoalService.processGoalBonusForLog', () => {
  const teamId = 'team-1';
  const teamSeasonPotId = 'pot-1';
  const baseGoal = {
    id: 'goal-1',
    teamId,
    targetMetric: WeeklyGoalTargetMetric.TOTAL_MINUTER,
    targetValue: 100,
    startDate: '2026-07-06',
    endDate: '2026-07-12',
    status: ChallengeStatus.ACTIVE,
    goalBonusAwardedAt: null as Date | null,
  };

  function buildService(options: {
    activeGoal: typeof baseGoal | null;
    players?: Player[];
    perPlayerRows?: { playerId: string; value: string }[];
    teamProgressSum?: number;
  }) {
    const challengeQb = makeQueryBuilder({ getOne: options.activeGoal });
    const challengeUpdate = jest.fn().mockResolvedValue(undefined);
    const challengeRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(challengeQb),
      update: challengeUpdate,
    };

    const trainingLogQb = makeQueryBuilder({
      getRawOne: { sum: String(options.teamProgressSum ?? 0) },
      getRawMany: options.perPlayerRows ?? [],
    });
    const trainingLogEntryRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(trainingLogQb),
    };

    const playerRepository = {
      find: jest.fn().mockResolvedValue(options.players ?? []),
    };

    const updatedPot = { id: teamSeasonPotId, pointsTotal: 999 };
    const teamPoolService = {
      addPoints: jest.fn().mockResolvedValue(updatedPot),
    };

    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        // WeeklyGoalService calls manager.getRepository(Challenge),
        // manager.getRepository(Player), and
        // manager.getRepository(TrainingLogEntry) — disambiguate by name
        // since these are plain classes here.
        const name = (entity as { name: string }).name;
        if (name === 'Challenge') return challengeRepository;
        if (name === 'Player') return playerRepository;
        return trainingLogEntryRepository;
      }),
    } as unknown as EntityManager;

    const service = new WeeklyGoalService(
      undefined as never,
      undefined as never,
      teamPoolService as never,
      challengeRepository as never,
      trainingLogEntryRepository as never,
      undefined as never,
      playerRepository as never,
    );

    return {
      service,
      manager,
      challengeUpdate,
      teamPoolService,
      updatedPot,
      trainingLogQb,
      playerRepository,
    };
  }

  it('returns null when the team has no active goal', async () => {
    const { service, manager } = buildService({ activeGoal: null });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );
    expect(result).toBeNull();
  });

  it("returns null when the log's date falls outside the goal's window", async () => {
    const { service, manager } = buildService({
      activeGoal: baseGoal,
      players: [makePlayer('p1')],
      perPlayerRows: [{ playerId: 'p1', value: '500' }],
    });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-20', // after endDate
    );
    expect(result).toBeNull();
  });

  it('returns null when the goal was already met (goalBonusAwardedAt already set) — the idempotency short-circuit', async () => {
    const alreadyAwarded = {
      ...baseGoal,
      goalBonusAwardedAt: new Date('2026-07-08'),
    };
    const { service, manager, teamPoolService } = buildService({
      activeGoal: alreadyAwarded,
      players: [makePlayer('p1')],
      perPlayerRows: [{ playerId: 'p1', value: '500' }],
    });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );
    expect(result).toBeNull();
    // Must not award again — the whole point of the flag.
    expect(teamPoolService.addPoints).not.toHaveBeenCalled();
  });

  it('returns null when not every eligible player has individually reached targetValue', async () => {
    const { service, manager, teamPoolService } = buildService({
      activeGoal: baseGoal, // targetValue: 100
      players: [makePlayer('p1'), makePlayer('p2')],
      // p1 hit the target, p2 (no row at all) is still at 0 — one highly
      // active player must not cover for a teammate under the new rule.
      perPlayerRows: [{ playerId: 'p1', value: '150' }],
    });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );
    expect(result).toBeNull();
    expect(teamPoolService.addPoints).not.toHaveBeenCalled();
  });

  it('returns null (vacuous-truth guard) when the eligible roster is empty — never awards for "0 of 0 players done"', async () => {
    const { service, manager, teamPoolService } = buildService({
      activeGoal: baseGoal,
      // Every current player fails eligibility (consent pending / team
      // join pending) — no logs needed since neither could legally log.
      players: [
        makePlayer('p1', {
          parentalConsentStatus: ParentalConsentStatus.PENDING,
        }),
        makePlayer('p2', { teamJoinStatus: TeamJoinStatus.PENDING }),
      ],
      perPlayerRows: [],
    });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );
    expect(result).toBeNull();
    expect(teamPoolService.addPoints).not.toHaveBeenCalled();
  });

  it('awards 5 + team-wide-minutes exactly once when every eligible player has reached targetValue, and persists both the flag and the amount', async () => {
    const { service, manager, teamPoolService, challengeUpdate, updatedPot } =
      buildService({
        activeGoal: baseGoal,
        players: [makePlayer('p1'), makePlayer('p2')],
        perPlayerRows: [
          { playerId: 'p1', value: '120' },
          { playerId: 'p2', value: '105' },
        ],
        teamProgressSum: 130, // team-wide bonus basis, independent number
      });

    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );

    expect(result).toEqual({ awardedPoints: 135, updatedPot });
    expect(teamPoolService.addPoints).toHaveBeenCalledWith(
      manager,
      teamSeasonPotId,
      135,
    );
    expect(challengeUpdate).toHaveBeenCalledWith(
      { id: baseGoal.id },
      expect.objectContaining({ goalBonusPointsAwarded: 135 }),
    );
    const [, setFields] = challengeUpdate.mock.calls[0] as [
      unknown,
      { goalBonusAwardedAt: Date },
    ];
    expect(setFields.goalBonusAwardedAt).toBeInstanceOf(Date);
  });

  it('a player who has NOT logged anything (ineligible — consent pending) does not block the award, and is excluded from both numerator and denominator', async () => {
    const { service, manager, teamPoolService } = buildService({
      activeGoal: baseGoal,
      players: [
        makePlayer('p1'), // eligible, hits target
        makePlayer('p2', {
          parentalConsentStatus: ParentalConsentStatus.PENDING,
        }), // ineligible — never logged anything
      ],
      perPlayerRows: [{ playerId: 'p1', value: '100' }],
      teamProgressSum: 100,
    });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );
    expect(result).toEqual({
      awardedPoints: 105,
      updatedPot: { id: teamSeasonPotId, pointsTotal: 999 },
    });
    expect(teamPoolService.addPoints).toHaveBeenCalledWith(
      manager,
      teamSeasonPotId,
      105,
    );
  });

  it('awards exactly when a player equals targetValue exactly (boundary, not only "over")', async () => {
    const { service, manager, teamPoolService, updatedPot } = buildService({
      activeGoal: baseGoal,
      players: [makePlayer('p1')],
      perPlayerRows: [{ playerId: 'p1', value: '100' }],
      teamProgressSum: 100,
    });
    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );
    expect(result).toEqual({
      awardedPoints: 105,
      updatedPot,
    });
    expect(teamPoolService.addPoints).toHaveBeenCalledWith(
      manager,
      teamSeasonPotId,
      105,
    );
  });

  it('filters the per-player progress query by activityType when targetMetric is a specific activity (drill-minuter), not total-minuter', async () => {
    const drillGoal = {
      ...baseGoal,
      targetMetric: WeeklyGoalTargetMetric.DRILL_MINUTER,
    };
    const { service, manager, trainingLogQb } = buildService({
      activeGoal: drillGoal,
      players: [makePlayer('p1')],
      perPlayerRows: [{ playerId: 'p1', value: '50' }],
    });
    await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );

    expect(trainingLogQb.andWhere).toHaveBeenCalledWith(
      'log.activity_type = :activityType',
      { activityType: ActivityType.DRILL },
    );
  });

  it('does NOT filter by activityType when targetMetric is total-minuter', async () => {
    const { service, manager, trainingLogQb } = buildService({
      activeGoal: baseGoal, // total-minuter
      players: [makePlayer('p1')],
      perPlayerRows: [{ playerId: 'p1', value: '50' }],
    });
    await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );

    const activityTypeCalls = trainingLogQb.andWhere.mock.calls.filter(
      ([sql]: [string]) => sql.includes('activity_type'),
    );
    expect(activityTypeCalls).toHaveLength(0);
  });

  it('uses COUNT(*), not SUM(duration_minutes), for a session-count (*-pass) metric', async () => {
    const passGoal = {
      ...baseGoal,
      targetMetric: WeeklyGoalTargetMetric.DRILL_PASS,
      targetValue: 2,
    };
    const { service, manager, teamPoolService, trainingLogQb } = buildService({
      activeGoal: passGoal,
      players: [makePlayer('p1')],
      // Two qualifying sessions — meets a target of 2 "pass".
      perPlayerRows: [{ playerId: 'p1', value: '2' }],
      teamProgressSum: 40, // unrelated minutes number, used only as the payout basis
    });

    const result = await service.processGoalBonusForLog(
      manager,
      teamId,
      teamSeasonPotId,
      '2026-07-08',
    );

    expect(trainingLogQb.addSelect).toHaveBeenCalledWith('COUNT(*)', 'value');
    expect(result).toEqual({
      awardedPoints: 45,
      updatedPot: { id: teamSeasonPotId, pointsTotal: 999 },
    });
    expect(teamPoolService.addPoints).toHaveBeenCalledWith(
      manager,
      teamSeasonPotId,
      45,
    );
  });
});

describe('WeeklyGoalService.patchGoal', () => {
  const teamId = 'team-1';
  const goalId = 'goal-1';
  const requesterId = 'player-captain';

  // patchGoal re-reads the row under a lock via a second createQueryBuilder
  // call (the "existing active goal" check) only when transitioning to
  // ACTIVE — not exercised by these tests, so a plain getOne-only builder
  // is enough here.
  function buildService(currentStatus: ChallengeStatus) {
    const goalRow = {
      id: goalId,
      teamId,
      title: 'Original title',
      description: 'Original description',
      targetMetric: WeeklyGoalTargetMetric.TOTAL_MINUTER,
      targetValue: 100,
      startDate: '2026-07-06',
      endDate: '2026-07-12',
      status: currentStatus,
      goalBonusAwardedAt: null,
      goalBonusPointsAwarded: null,
    };

    const qb = makeQueryBuilder({ getOne: goalRow });
    const save = jest.fn((entity: typeof goalRow) => Promise.resolve(entity));
    const challengeRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save,
    };

    const manager = {
      getRepository: jest.fn().mockReturnValue(challengeRepository),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn((cb: (manager: EntityManager) => unknown) =>
        cb(manager),
      ),
    };

    const playersService = {
      assertIsCaptainOfTeam: jest.fn().mockResolvedValue(undefined),
    };

    const service = new WeeklyGoalService(
      dataSource as never,
      playersService as never,
      undefined as never,
      challengeRepository as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    return { service, goalRow, save };
  }

  it('rejects a title change on a completed goal — the confirmed code-critic finding', async () => {
    const { service } = buildService(ChallengeStatus.COMPLETED);
    await expect(
      service.patchGoal(teamId, goalId, requesterId, { title: 'New title' }),
    ).rejects.toBeInstanceOf(ChallengeAlreadyTerminalException);
  });

  it('rejects a description change on a cancelled goal', async () => {
    const { service } = buildService(ChallengeStatus.CANCELLED);
    await expect(
      service.patchGoal(teamId, goalId, requesterId, {
        description: 'New description',
      }),
    ).rejects.toBeInstanceOf(ChallengeAlreadyTerminalException);
  });

  it('allows a title change while draft', async () => {
    const { service, save } = buildService(ChallengeStatus.DRAFT);
    await service.patchGoal(teamId, goalId, requesterId, {
      title: 'Updated title',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Updated title' }),
    );
  });

  it('allows a description change while active (non-terminal, non-draft)', async () => {
    const { service, save } = buildService(ChallengeStatus.ACTIVE);
    await service.patchGoal(teamId, goalId, requesterId, {
      description: 'Updated description',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Updated description' }),
    );
  });

  it('still rejects a frozen-field change (targetValue) once active — unaffected by this fix', async () => {
    const { service } = buildService(ChallengeStatus.ACTIVE);
    await expect(
      service.patchGoal(teamId, goalId, requesterId, { targetValue: 200 }),
    ).rejects.toBeInstanceOf(ChallengeTargetFrozenException);
  });
});

// docs/adr/0015-weekly-goal-per-player-completion.md Decision 2/3 — the
// read-path (GET /weekly-goal) building the per-player breakdown, exercised
// through the public getCurrentGoalForTeam rather than the private
// buildGoalProgressSummary/buildPlayerGoalProgress directly.
describe('WeeklyGoalService.getCurrentGoalForTeam — per-player breakdown (ADR-0015)', () => {
  const teamId = 'team-1';
  const requesterId = 'player-1';

  const goalRow = {
    id: 'goal-1',
    teamId,
    title: 'Titel',
    description: 'Beskrivning',
    targetMetric: WeeklyGoalTargetMetric.TOTAL_MINUTER,
    targetValue: 100,
    startDate: '2026-07-06',
    endDate: '2026-07-12',
    status: ChallengeStatus.ACTIVE,
    createdByPlayerId: 'captain-1',
    goalBonusAwardedAt: null,
    goalBonusPointsAwarded: null,
  };

  function buildService(options: {
    requesterIsCaptain: boolean;
    players: Player[];
    perPlayerRows: { playerId: string; value: string }[];
  }) {
    const challengeRepository = {
      findOne: jest.fn().mockResolvedValue(goalRow),
    };

    const playerRepository = {
      find: jest.fn().mockResolvedValue(options.players),
    };

    const trainingLogQb = makeQueryBuilder({
      getRawOne: { sum: '0' },
      getRawMany: options.perPlayerRows,
    });
    const trainingLogEntryRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(trainingLogQb),
    };

    const playersService = {
      assertTeamMembership: jest.fn().mockResolvedValue({
        id: requesterId,
        isCaptain: options.requesterIsCaptain,
      }),
    };

    const service = new WeeklyGoalService(
      undefined as never,
      playersService as never,
      undefined as never,
      challengeRepository as never,
      trainingLogEntryRepository as never,
      undefined as never,
      playerRepository as never,
    );

    return { service };
  }

  it('computes eligiblePlayerCount/completedPlayerCount/goalMet/percentComplete from a mix of eligible/ineligible/completed/incomplete players', async () => {
    const players = [
      makePlayer('p-done'), // eligible, meets target
      makePlayer('p-short'), // eligible, below target
      makePlayer('p-pending', {
        parentalConsentStatus: ParentalConsentStatus.PENDING,
      }), // ineligible
    ];
    const { service } = buildService({
      requesterIsCaptain: true,
      players,
      perPlayerRows: [
        { playerId: 'p-done', value: '100' },
        { playerId: 'p-short', value: '40' },
      ],
    });

    const result = await service.getCurrentGoalForTeam(teamId, requesterId);

    expect(result.goal).not.toBeNull();
    expect(result.goal!.eligiblePlayerCount).toBe(2);
    expect(result.goal!.completedPlayerCount).toBe(1);
    expect(result.goal!.goalMet).toBe(false); // p-short hasn't hit target
    expect(result.goal!.percentComplete).toBe(50);
    expect(result.goal!.players).toHaveLength(3);

    const done = result.goal!.players.find((p) => p.playerId === 'p-done')!;
    expect(done).toMatchObject({
      eligible: true,
      goalMet: true,
      progressValue: 100,
    });

    const short = result.goal!.players.find((p) => p.playerId === 'p-short')!;
    expect(short).toMatchObject({
      eligible: true,
      goalMet: false,
      progressValue: 40,
    });

    const pending = result.goal!.players.find(
      (p) => p.playerId === 'p-pending',
    )!;
    expect(pending).toMatchObject({
      eligible: false,
      goalMet: false,
      progressValue: 0,
    });
  });

  it('goalMet is true only once every eligible player individually meets the target', async () => {
    const players = [makePlayer('p1'), makePlayer('p2')];
    const { service } = buildService({
      requesterIsCaptain: true,
      players,
      perPlayerRows: [
        { playerId: 'p1', value: '100' },
        { playerId: 'p2', value: '100' },
      ],
    });

    const result = await service.getCurrentGoalForTeam(teamId, requesterId);
    expect(result.goal!.goalMet).toBe(true);
    expect(result.goal!.eligiblePlayerCount).toBe(2);
    expect(result.goal!.completedPlayerCount).toBe(2);
    expect(result.goal!.percentComplete).toBe(100);
  });

  it('vacuous-truth guard: an all-ineligible roster is 0 eligible, 0 completed, and goalMet: false (never vacuously true)', async () => {
    const players = [
      makePlayer('p1', {
        parentalConsentStatus: ParentalConsentStatus.PENDING,
      }),
      makePlayer('p2', { teamJoinStatus: TeamJoinStatus.PENDING }),
      makePlayer('p3', { createdAt: new Date('2026-07-09T00:00:00Z') }), // joined after goal.startDate (2026-07-06)
    ];
    const { service } = buildService({
      requesterIsCaptain: true,
      players,
      perPlayerRows: [],
    });

    const result = await service.getCurrentGoalForTeam(teamId, requesterId);
    expect(result.goal!.eligiblePlayerCount).toBe(0);
    expect(result.goal!.completedPlayerCount).toBe(0);
    expect(result.goal!.goalMet).toBe(false);
    expect(result.goal!.percentComplete).toBe(0);
  });

  // docs/adr/0015-weekly-goal-per-player-completion.md Decision 4 — a real
  // privacy finding: exclusionReason is captain-only, mirroring
  // PlayersService.getRoster's existing captain-only consentStatus gating.
  describe('exclusionReason captain-only gating (Decision 4)', () => {
    const players = [
      makePlayer('p-revoked', {
        parentalConsentStatus: ParentalConsentStatus.REVOKED,
      }),
    ];

    it('nulls exclusionReason for a non-captain viewer, while eligible: false stays visible', async () => {
      const { service } = buildService({
        requesterIsCaptain: false,
        players,
        perPlayerRows: [],
      });
      const result = await service.getCurrentGoalForTeam(teamId, requesterId);
      const player = result.goal!.players[0];
      expect(player.eligible).toBe(false);
      expect(player.exclusionReason).toBeNull();
    });

    it('exposes the real exclusionReason to the team captain', async () => {
      const { service } = buildService({
        requesterIsCaptain: true,
        players,
        perPlayerRows: [],
      });
      const result = await service.getCurrentGoalForTeam(teamId, requesterId);
      const player = result.goal!.players[0];
      expect(player.eligible).toBe(false);
      expect(player.exclusionReason).toBe('consent_revoked');
    });
  });
});

// docs/adr/0016-cross-team-leaderboard-fairness.md's 2026-07-31 addendum —
// the actual call site of the privacy fix (bucketEligiblePlayerCount).
// TeamPoolService's own unit tests cover the bucket boundaries and the
// shrinkage math in isolation; this describe block exists specifically to
// guard the wiring in getLeaderboard() itself, so a future refactor that
// accidentally passed the exact eligiblePlayerCount straight through to
// effortLeaderboard (reintroducing the leak security-reviewer caught)
// would fail a test, not just ship silently.
describe('WeeklyGoalService.getLeaderboard — ADR-0016 eligiblePlayerCount bucketing wiring', () => {
  const teamId = 'team-1';
  const requesterId = 'player-1';

  function buildService(effortRows: EffortLeaderboardRow[]) {
    const playersService = {
      assertTeamMembership: jest.fn().mockResolvedValue(undefined),
    };
    const teamPoolService = {
      getLeaderboard: jest.fn().mockResolvedValue([]),
      getEffortLeaderboard: jest.fn().mockResolvedValue(effortRows),
    };

    const service = new WeeklyGoalService(
      undefined as never,
      playersService as never,
      teamPoolService as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    return { service };
  }

  it('never exposes an exact eligiblePlayerCount on any effortLeaderboard row, own team included — only the bucketed range', async () => {
    const { service } = buildService([
      {
        rank: 1,
        teamId: 'team-1', // the requesting team's own row
        teamName: 'IBK Falken P13',
        eligiblePlayerCount: 4,
        pointsPerPlayer: 300,
        adjustedScore: 231.5,
      },
      {
        rank: 2,
        teamId: 'team-2',
        teamName: 'IBK Härnösand P12',
        eligiblePlayerCount: 15,
        pointsPerPlayer: 200,
        adjustedScore: 199.0,
      },
      {
        rank: 3,
        teamId: 'team-3',
        teamName: 'A tiny new team',
        eligiblePlayerCount: 1,
        pointsPerPlayer: 500,
        adjustedScore: 176.9,
      },
    ]);

    const result = await service.getLeaderboard(teamId, requesterId);

    for (const row of result.effortLeaderboard) {
      expect(row).not.toHaveProperty('eligiblePlayerCount');
      expect(['1-2', '3-5', '6+']).toContain(row.eligiblePlayerCountRange);
    }
    expect(
      result.effortLeaderboard.find((r) => r.teamId === 'team-1')!
        .eligiblePlayerCountRange,
    ).toBe('3-5');
    expect(
      result.effortLeaderboard.find((r) => r.teamId === 'team-2')!
        .eligiblePlayerCountRange,
    ).toBe('6+');
    // The single-player team — the exact scenario the finding was about —
    // must never surface as a bare '1' anywhere in the response.
    expect(
      result.effortLeaderboard.find((r) => r.teamId === 'team-3')!
        .eligiblePlayerCountRange,
    ).toBe('1-2');
  });

  it("still exposes the requesting team's own exact eligiblePlayerCount via requestingTeamEffort — unaffected by the bucketing fix", async () => {
    const { service } = buildService([
      {
        rank: 1,
        teamId: 'team-1',
        teamName: 'IBK Falken P13',
        eligiblePlayerCount: 4,
        pointsPerPlayer: 300,
        adjustedScore: 231.5,
      },
    ]);

    const result = await service.getLeaderboard(teamId, requesterId);

    expect(result.requestingTeamEffort).not.toBeNull();
    expect(result.requestingTeamEffort!.eligiblePlayerCount).toBe(4);
  });

  it('returns requestingTeamEffort: null when the requesting team has no eligible players (absent from effortRows)', async () => {
    const { service } = buildService([]);

    const result = await service.getLeaderboard(teamId, requesterId);

    expect(result.requestingTeamEffort).toBeNull();
    expect(result.effortLeaderboard).toEqual([]);
  });
});
