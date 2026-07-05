import { EntityManager } from 'typeorm';
import { ActivityType } from '../training-logs/activity-type.enum';
import { ChallengeStatus } from '../challenges/entities/challenge.entity';
import { WeeklyGoalTargetMetric } from './weekly-goal-target-metric.enum';
import { WeeklyGoalService } from './weekly-goal.service';

// Chainable fake query builder — every method returns `this` except the
// terminal ones (getOne/getRawOne/getRawMany/getMany), which are
// configurable per test. Mirrors the subset of TypeORM's QueryBuilder API
// WeeklyGoalService actually calls.
function makeQueryBuilder(terminal: { getOne?: unknown; getRawOne?: unknown }) {
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
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb;
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
    progressSum: number;
  }) {
    const challengeQb = makeQueryBuilder({ getOne: options.activeGoal });
    const challengeUpdate = jest.fn().mockResolvedValue(undefined);
    const challengeRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(challengeQb),
      update: challengeUpdate,
    };

    const trainingLogQb = makeQueryBuilder({
      getRawOne: { sum: String(options.progressSum) },
    });
    const trainingLogEntryRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(trainingLogQb),
    };

    const updatedPot = { id: teamSeasonPotId, pointsTotal: 999 };
    const teamPoolService = {
      addPoints: jest.fn().mockResolvedValue(updatedPot),
    };

    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        // WeeklyGoalService calls manager.getRepository(Challenge) and
        // manager.getRepository(TrainingLogEntry) — disambiguate by name
        // since both are plain classes here.
        const name = (entity as { name: string }).name;
        return name === 'Challenge'
          ? challengeRepository
          : trainingLogEntryRepository;
      }),
    } as unknown as EntityManager;

    const service = new WeeklyGoalService(
      undefined as never,
      undefined as never,
      teamPoolService as never,
      challengeRepository as never,
      trainingLogEntryRepository as never,
    );

    return {
      service,
      manager,
      challengeUpdate,
      teamPoolService,
      updatedPot,
      trainingLogQb,
    };
  }

  it('returns null when the team has no active goal', async () => {
    const { service, manager } = buildService({
      activeGoal: null,
      progressSum: 0,
    });
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
      progressSum: 500,
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
      progressSum: 500,
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

  it('returns null when team-wide progress is still below targetValue', async () => {
    const { service, manager, teamPoolService } = buildService({
      activeGoal: baseGoal,
      progressSum: 99, // targetValue is 100
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

  it('awards 5 + progress exactly once when progress first meets targetValue, and persists both the flag and the amount', async () => {
    const { service, manager, teamPoolService, challengeUpdate, updatedPot } =
      buildService({ activeGoal: baseGoal, progressSum: 130 });

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

  it('awards exactly when progress equals targetValue exactly (boundary, not only "over")', async () => {
    const { service, manager, teamPoolService, updatedPot } = buildService({
      activeGoal: baseGoal,
      progressSum: 100,
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

  it('filters by activityType when targetMetric is a specific activity (drill-minuter), not total-minuter', async () => {
    const drillGoal = {
      ...baseGoal,
      targetMetric: WeeklyGoalTargetMetric.DRILL_MINUTER,
    };
    const { service, manager, trainingLogQb } = buildService({
      activeGoal: drillGoal,
      progressSum: 50,
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
      progressSum: 50,
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
});
