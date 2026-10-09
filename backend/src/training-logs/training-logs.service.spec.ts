import { EntityManager } from 'typeorm';
import {
  ConsentRequiredException,
  TrainingTimerAlreadyUsedException,
  TrainingTimerNotUsableException,
  TrainingTimerTooShortException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { VideoClipStatus } from '../video-clips/entities/video-clip.entity';
import { ActivityType } from './activity-type.enum';
import { TrainingLogEntry } from './entities/training-log-entry.entity';
import { TrainingTimer } from './entities/training-timer.entity';
import { EvidenceTier } from './points.util';
import { TrainingLogsService } from './training-logs.service';
import { TrainingTimersService } from './training-timers.service';

// docs/adr/0038 — the countdown-timer tier and the weekly click-only cap.
//
// Same "fake manager whose getRepository returns plain jest-mocked
// repositories" shape as weekly-goal.service.spec.ts. The click-only count
// is a query builder whose terminal getRawOne is configurable per test, so
// "how many taps came before this one" is an input here, not a database.

// Wednesday 2026-10-07 12:00 in Stockholm (CEST, UTC+2).
const WEDNESDAY = new Date('2026-10-07T10:00:00Z');
const MINUTE = 60 * 1000;

function makeCountQueryBuilder(count: number) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where', 'andWhere']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawOne = jest.fn().mockResolvedValue({ count: String(count) });
  return qb;
}

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'player-1',
    teamId: 'team-1',
    parentalConsentStatus: ParentalConsentStatus.APPROVED,
    teamJoinStatus: TeamJoinStatus.APPROVED,
    currentStreakCount: 2,
    longestStreakCount: 5,
    lastTrainedDate: '2026-10-06',
    bankedStreakSaverCount: 0,
    ...overrides,
  };
}

function buildService(
  options: {
    priorClickOnlyLogs?: number;
    timer?: Partial<TrainingTimer> | null;
    clip?: { createdAt: Date } | null;
  } = {},
) {
  const countQb = makeCountQueryBuilder(options.priorClickOnlyLogs ?? 0);

  const logRepository = {
    create: jest.fn((input: Partial<TrainingLogEntry>) => input),
    save: jest.fn((entity: Partial<TrainingLogEntry>) =>
      Promise.resolve({ id: 'log-1', ...entity }),
    ),
    createQueryBuilder: jest.fn(() => countQb),
  };
  const timerRepository = {
    findOne: jest.fn(() =>
      Promise.resolve(
        options.timer === undefined || options.timer === null
          ? null
          : {
              id: 'timer-1',
              playerId: 'player-1',
              activityType: ActivityType.RUNNING,
              plannedMinutes: 30,
              consumedAt: null,
              startedAt: new Date(WEDNESDAY.getTime() - 45 * MINUTE),
              ...options.timer,
            },
      ),
    ),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === TrainingLogEntry) return logRepository;
      if (entity === TrainingTimer) return timerRepository;
      throw new Error(`unexpected repository ${String(entity)}`);
    }),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn((cb: (m: EntityManager) => unknown) => cb(manager)),
  };
  const playersService = {
    findByIdOrThrow: jest.fn(() => Promise.resolve(makePlayer())),
    findByIdForUpdate: jest.fn(() => Promise.resolve(makePlayer())),
    updateStreakFields: jest.fn(() => Promise.resolve()),
  };
  const teamPoolService = {
    getActivePotForTeam: jest.fn(() =>
      Promise.resolve({ id: 'pot-1', pointsTotal: 100 }),
    ),
    addPoints: jest.fn((_m: unknown, id: string, points: number) =>
      Promise.resolve({ id, pointsTotal: 100 + points }),
    ),
  };
  const weeklyGoalService = {
    processGoalBonusForLog: jest.fn(() => Promise.resolve(null)),
  };
  const redisService = {
    markLoggedToday: jest.fn(() => Promise.resolve()),
    setTeamPoolGauge: jest.fn(() => Promise.resolve()),
    updateLeaderboard: jest.fn(() => Promise.resolve()),
  };
  // The injected (non-transactional) repository: the clip-reuse check, and
  // the unlocked allowance preview.
  const injectedLogRepository = {
    findOne: jest.fn(() => Promise.resolve(null)),
    createQueryBuilder: jest.fn(() => countQb),
  };
  const videoClipRepository = {
    findOne: jest.fn(() =>
      Promise.resolve(
        options.clip
          ? {
              id: 'clip-1',
              uploaderPlayerId: 'player-1',
              status: VideoClipStatus.PUBLISHED,
              ...options.clip,
            }
          : null,
      ),
    ),
  };

  const service = new TrainingLogsService(
    dataSource as never,
    playersService as never,
    teamPoolService as never,
    weeklyGoalService as never,
    redisService as never,
    injectedLogRepository as never,
    videoClipRepository as never,
  );

  return {
    service,
    countQb,
    logRepository,
    timerRepository,
    playersService,
    teamPoolService,
    weeklyGoalService,
  };
}

describe('TrainingLogsService — weekly click-only cap (ADR-0038 Decision 4)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(WEDNESDAY);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const tap = { activityType: ActivityType.RUNNING, durationMinutes: 20 };

  it('pays the 3rd click-only log of the week at x0.1 and reports 3 of 3 used', async () => {
    const { service, teamPoolService } = buildService({
      priorClickOnlyLogs: 2,
    });

    const result = await service.logTraining('player-1', tap);

    expect(result.pointsAwarded).toBe(2);
    expect(teamPoolService.addPoints).toHaveBeenCalledWith(
      expect.anything(),
      'pot-1',
      2,
    );
    expect(result.teamPool.pointsTotal).toBe(102);
    expect(result.clickOnlyAllowance).toEqual({
      used: 3,
      limit: 3,
      resetsOn: '2026-10-12',
    });
  });

  it('still saves the 4th, still counts it for the streak and the weekly goal, but pays 0', async () => {
    const {
      service,
      logRepository,
      teamPoolService,
      playersService,
      weeklyGoalService,
    } = buildService({ priorClickOnlyLogs: 3 });

    const result = await service.logTraining('player-1', tap);

    expect(result.pointsAwarded).toBe(0);
    expect(teamPoolService.addPoints).not.toHaveBeenCalled();
    expect(result.teamPool.pointsTotal).toBe(100);
    // Saved, at its full minutes — weekly goals count minutes and sessions.
    expect(logRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 20,
        evidenceTier: EvidenceTier.CLICK_ONLY,
      }),
    );
    expect(playersService.updateStreakFields).toHaveBeenCalled();
    expect(result.streak.currentStreakCount).toBe(3);
    expect(weeklyGoalService.processGoalBonusForLog).toHaveBeenCalledWith(
      expect.anything(),
      'team-1',
      'pot-1',
      '2026-10-07',
    );
    // "3 of 3", never "4 of 3".
    expect(result.clickOnlyAllowance.used).toBe(3);
  });

  it('counts within the Monday–Sunday Stockholm week, under the player lock', async () => {
    const { service, countQb, playersService } = buildService();

    await service.logTraining('player-1', tap);

    expect(countQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("AT TIME ZONE 'Europe/Stockholm'"),
      { weekStart: '2026-10-05', weekEnd: '2026-10-11' },
    );
    expect(countQb.andWhere).toHaveBeenCalledWith(expect.any(String), {
      tier: EvidenceTier.CLICK_ONLY,
    });
    // Taken after the row lock, so two concurrent taps cannot both be the 3rd.
    expect(
      playersService.findByIdForUpdate.mock.invocationCallOrder[0],
    ).toBeLessThan(countQb.getRawOne.mock.invocationCallOrder[0]);
  });

  it('resets in a new week: the first tap after Monday 00:00 Stockholm pays again', async () => {
    // Sunday 2026-10-11 22:30Z is already Monday 2026-10-12 00:30 in Stockholm.
    jest.setSystemTime(new Date('2026-10-11T22:30:00Z'));
    const { service, countQb } = buildService({ priorClickOnlyLogs: 0 });

    const result = await service.logTraining('player-1', tap);

    expect(countQb.andWhere).toHaveBeenCalledWith(expect.any(String), {
      weekStart: '2026-10-12',
      weekEnd: '2026-10-18',
    });
    expect(result.pointsAwarded).toBe(2);
    expect(result.clickOnlyAllowance).toEqual({
      used: 1,
      limit: 3,
      resetsOn: '2026-10-19',
    });
  });

  it('never caps a timed log, and a timed log does not use up a tap', async () => {
    const { service } = buildService({ priorClickOnlyLogs: 5, timer: {} });

    const result = await service.logTraining('player-1', {
      ...tap,
      durationMinutes: 30,
      timerId: 'timer-1',
    });

    expect(result.pointsAwarded).toBe(30);
    expect(result.clickOnlyAllowance.used).toBe(3);
  });

  it('serves the same allowance shape from the preview endpoint', async () => {
    const { service } = buildService({ priorClickOnlyLogs: 1 });

    await expect(service.getClickOnlyAllowance('player-1')).resolves.toEqual({
      used: 1,
      limit: 3,
      resetsOn: '2026-10-12',
    });
  });
});

describe('TrainingLogsService — countdown timer (ADR-0038 Decisions 2, 3, 5)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(WEDNESDAY);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const startedMinutesAgo = (minutes: number) =>
    new Date(WEDNESDAY.getTime() - minutes * MINUTE);

  it('clamps the claimed duration to the planned minutes', async () => {
    const { service, logRepository, timerRepository } = buildService({
      timer: { plannedMinutes: 30, startedAt: startedMinutesAgo(45) },
    });

    const result = await service.logTraining('player-1', {
      activityType: ActivityType.RUNNING,
      durationMinutes: 60,
      timerId: 'timer-1',
    });

    expect(logRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 30,
        evidenceTier: EvidenceTier.TIMED,
        timerId: 'timer-1',
      }),
    );
    expect(result.pointsAwarded).toBe(30);
    expect(timerRepository.update).toHaveBeenCalledWith(
      { id: 'timer-1' },
      { consumedAt: WEDNESDAY },
    );
  });

  it('clamps to the claimed duration when the player reports less', async () => {
    const { service, logRepository } = buildService({
      timer: { plannedMinutes: 30, startedAt: startedMinutesAgo(45) },
    });

    await service.logTraining('player-1', {
      activityType: ActivityType.RUNNING,
      durationMinutes: 10,
      timerId: 'timer-1',
    });

    expect(logRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 10 }),
    );
  });

  it('pays the whole minutes done when stopped early (Decision 3)', async () => {
    const { service, logRepository } = buildService({
      timer: { plannedMinutes: 30, startedAt: startedMinutesAgo(20.5) },
    });

    const result = await service.logTraining('player-1', {
      activityType: ActivityType.RUNNING,
      durationMinutes: 30,
      timerId: 'timer-1',
    });

    expect(logRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 20 }),
    );
    expect(result.pointsAwarded).toBe(20);
  });

  it('rejects under one whole elapsed minute, and leaves the timer open', async () => {
    const { service, logRepository, timerRepository } = buildService({
      timer: { startedAt: new Date(WEDNESDAY.getTime() - 59 * 1000) },
    });

    await expect(
      service.logTraining('player-1', {
        activityType: ActivityType.RUNNING,
        durationMinutes: 30,
        timerId: 'timer-1',
      }),
    ).rejects.toBeInstanceOf(TrainingTimerTooShortException);
    expect(timerRepository.update).not.toHaveBeenCalled();
    expect(logRepository.save).not.toHaveBeenCalled();
  });

  it('lets a clip set the tier while the timer still fixes the minutes (Decision 5)', async () => {
    const { service, logRepository, timerRepository } = buildService({
      timer: { plannedMinutes: 20, startedAt: startedMinutesAgo(25) },
      clip: { createdAt: startedMinutesAgo(2) },
    });

    const result = await service.logTraining('player-1', {
      activityType: ActivityType.RUNNING,
      durationMinutes: 45,
      timerId: 'timer-1',
      evidenceClipId: 'clip-1',
      sharedWithTeam: true,
    });

    expect(logRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 20,
        evidenceTier: EvidenceTier.VIDEO_SHARED_WITH_TEAM,
        evidenceClipId: 'clip-1',
        timerId: 'timer-1',
      }),
    );
    // 20 x 1.4 — never 20 x (1 + 1.4).
    expect(result.pointsAwarded).toBe(28);
    expect(timerRepository.update).toHaveBeenCalled();
  });

  it('rejects a timer that has already verified a log', async () => {
    const { service, logRepository } = buildService({
      timer: { consumedAt: startedMinutesAgo(5) },
    });

    await expect(
      service.logTraining('player-1', {
        activityType: ActivityType.RUNNING,
        durationMinutes: 30,
        timerId: 'timer-1',
      }),
    ).rejects.toBeInstanceOf(TrainingTimerAlreadyUsedException);
    expect(logRepository.save).not.toHaveBeenCalled();
  });

  it("rejects a timer that does not exist or is not this player's", async () => {
    const { service, timerRepository } = buildService({ timer: null });

    await expect(
      service.logTraining('player-1', {
        activityType: ActivityType.RUNNING,
        durationMinutes: 30,
        timerId: 'timer-1',
      }),
    ).rejects.toBeInstanceOf(TrainingTimerNotUsableException);
    // Ownership is part of the lookup itself.
    expect(timerRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'timer-1', playerId: 'player-1' },
    });
  });

  it('rejects a timer older than 24 hours', async () => {
    const { service } = buildService({
      timer: { startedAt: startedMinutesAgo(24 * 60 + 1) },
    });

    await expect(
      service.logTraining('player-1', {
        activityType: ActivityType.RUNNING,
        durationMinutes: 30,
        timerId: 'timer-1',
      }),
    ).rejects.toBeInstanceOf(TrainingTimerNotUsableException);
  });
});

describe('TrainingTimersService.start (ADR-0038 Decision 2)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(WEDNESDAY);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function buildTimersService(player = makePlayer()) {
    const timerRepository = {
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
      create: jest.fn((input: Partial<TrainingTimer>) => input),
      save: jest.fn((entity: Partial<TrainingTimer>) =>
        Promise.resolve({ id: 'timer-2', ...entity }),
      ),
    };
    const manager = {
      getRepository: jest.fn(() => timerRepository),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((cb: (m: EntityManager) => unknown) => cb(manager)),
    };
    const playersService = {
      findByIdOrThrow: jest.fn(() => Promise.resolve(player)),
      findByIdForUpdate: jest.fn(() => Promise.resolve(player)),
    };
    const service = new TrainingTimersService(
      dataSource as never,
      playersService as never,
    );
    return { service, timerRepository, dataSource };
  }

  it('stamps a server startedAt and returns endsAt = startedAt + plannedMinutes', async () => {
    const { service } = buildTimersService();

    await expect(
      service.start('player-1', {
        activityType: ActivityType.RUNNING,
        plannedMinutes: 30,
      }),
    ).resolves.toEqual({
      timerId: 'timer-2',
      startedAt: '2026-10-07T10:00:00.000Z',
      plannedMinutes: 30,
      endsAt: '2026-10-07T10:30:00.000Z',
    });
  });

  it("abandons the player's open timer before starting a new one", async () => {
    const { service, timerRepository } = buildTimersService();

    await service.start('player-1', {
      activityType: ActivityType.RUNNING,
      plannedMinutes: 15,
    });

    const [criteria] = timerRepository.delete.mock.calls[0] as unknown as [
      { playerId: string; consumedAt: unknown },
    ];
    expect(criteria.playerId).toBe('player-1');
    // IsNull() — only the unconsumed timer goes; consumed ones are the
    // audit trail of timed logs.
    expect(criteria.consumedAt).toEqual(
      expect.objectContaining({ _type: 'isNull' }),
    );
    expect(timerRepository.delete.mock.invocationCallOrder[0]).toBeLessThan(
      timerRepository.save.mock.invocationCallOrder[0],
    );
  });

  it('applies the same consent gate as logging', async () => {
    const { service, dataSource } = buildTimersService(
      makePlayer({ parentalConsentStatus: ParentalConsentStatus.PENDING }),
    );

    await expect(
      service.start('player-1', {
        activityType: ActivityType.RUNNING,
        plannedMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(ConsentRequiredException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
