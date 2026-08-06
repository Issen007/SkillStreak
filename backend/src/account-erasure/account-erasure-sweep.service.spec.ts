import { AccountErasureSweepService } from './account-erasure-sweep.service';

function buildService(overrides: {
  accountErasureService?: Record<string, jest.Mock>;
  playersService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
}) {
  const accountErasureService = {
    findDueRows: jest.fn().mockResolvedValue([]),
    executeTeamCascade: jest.fn().mockResolvedValue(undefined),
    executeSingleErasure: jest.fn().mockResolvedValue(undefined),
    ...overrides.accountErasureService,
  };
  const playersService = {
    listByTeam: jest.fn().mockResolvedValue([]),
    ...overrides.playersService,
  };
  const redisService = {
    // Wins the scheduled-job-run claim by default — see the dedicated
    // "skips when another replica already claimed this run" test below.
    tryClaimScheduledJobRun: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };

  const service = new AccountErasureSweepService(
    accountErasureService as never,
    playersService as never,
    redisService as never,
  );

  return { service, accountErasureService, playersService, redisService };
}

// docs/adr/0013-account-erasure.md Decision 5/8 — the security-reviewer's
// 2026-07-29 refinement: due rows are grouped by team_id BEFORE processing
// any of them, and "am I the last player on this team" accounts for every
// other player from the SAME team due in this SAME run, not just the
// team's currently-stored roster count.
describe('AccountErasureSweepService.sweep', () => {
  it('does nothing when there are no due rows', async () => {
    const { service, playersService, accountErasureService } = buildService({});

    await service.sweep();

    expect(playersService.listByTeam).not.toHaveBeenCalled();
    expect(accountErasureService.executeTeamCascade).not.toHaveBeenCalled();
    expect(accountErasureService.executeSingleErasure).not.toHaveBeenCalled();
  });

  it('routes the ordinary single-player case through executeTeamCascade (survivingCount === 0)', async () => {
    const row = { id: 'e-1', playerId: 'p-1', teamId: 'team-1' };
    const { service, accountErasureService } = buildService({
      accountErasureService: {
        findDueRows: jest.fn().mockResolvedValue([row]),
      },
      playersService: {
        listByTeam: jest.fn().mockResolvedValue([{ id: 'p-1' }]),
      },
    });

    await service.sweep();

    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledWith(
      'team-1',
      [row],
    );
    expect(accountErasureService.executeSingleErasure).not.toHaveBeenCalled();
  });

  it('computes survivingCount against the WHOLE same-team batch, not per-row — three due players on one team, all still route through executeTeamCascade once', async () => {
    const rows = [
      { id: 'e-1', playerId: 'p-1', teamId: 'team-1' },
      { id: 'e-2', playerId: 'p-2', teamId: 'team-1' },
      { id: 'e-3', playerId: 'p-3', teamId: 'team-1' },
    ];
    const { service, accountErasureService } = buildService({
      accountErasureService: {
        findDueRows: jest.fn().mockResolvedValue(rows),
      },
      playersService: {
        listByTeam: jest
          .fn()
          .mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }, { id: 'p-3' }]),
      },
    });

    await service.sweep();

    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledTimes(1);
    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledWith(
      'team-1',
      rows,
    );
  });

  it('processes each row individually, excluding the WHOLE batch from the auto-fallback pool, when the team continues (survivingCount > 0)', async () => {
    const rows = [
      { id: 'e-1', playerId: 'p-1', teamId: 'team-1' },
      { id: 'e-2', playerId: 'p-2', teamId: 'team-1' },
    ];
    const { service, accountErasureService } = buildService({
      accountErasureService: {
        findDueRows: jest.fn().mockResolvedValue(rows),
      },
      playersService: {
        listByTeam: jest.fn().mockResolvedValue([
          { id: 'p-1' },
          { id: 'p-2' },
          { id: 'p-3' }, // survives
        ]),
      },
    });

    await service.sweep();

    expect(accountErasureService.executeTeamCascade).not.toHaveBeenCalled();
    expect(accountErasureService.executeSingleErasure).toHaveBeenCalledTimes(2);
    expect(accountErasureService.executeSingleErasure).toHaveBeenCalledWith(
      rows[0],
      ['p-1', 'p-2'],
    );
    expect(accountErasureService.executeSingleErasure).toHaveBeenCalledWith(
      rows[1],
      ['p-1', 'p-2'],
    );
  });

  it("processes each team's batch independently — one team's due rows never block another's", async () => {
    const teamARow = { id: 'e-1', playerId: 'p-1', teamId: 'team-a' };
    const teamBRow = { id: 'e-2', playerId: 'p-2', teamId: 'team-b' };
    const { service, accountErasureService, playersService } = buildService({
      accountErasureService: {
        findDueRows: jest.fn().mockResolvedValue([teamARow, teamBRow]),
      },
      playersService: {
        listByTeam: jest.fn((teamId: string) =>
          Promise.resolve(
            teamId === 'team-a' ? [{ id: 'p-1' }] : [{ id: 'p-2' }],
          ),
        ),
      },
    });

    await service.sweep();

    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledWith(
      'team-a',
      [teamARow],
    );
    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledWith(
      'team-b',
      [teamBRow],
    );
    expect(playersService.listByTeam).toHaveBeenCalledTimes(2);
  });

  it("a failure on one team's batch is logged and does not prevent another team's batch from processing in the same run", async () => {
    const teamARow = { id: 'e-1', playerId: 'p-1', teamId: 'team-a' };
    const teamBRow = { id: 'e-2', playerId: 'p-2', teamId: 'team-b' };
    const { service, accountErasureService } = buildService({
      accountErasureService: {
        findDueRows: jest.fn().mockResolvedValue([teamARow, teamBRow]),
        executeTeamCascade: jest
          .fn()
          .mockImplementation((teamId: string) =>
            teamId === 'team-a'
              ? Promise.reject(new Error('minio unreachable'))
              : Promise.resolve(undefined),
          ),
      },
      playersService: {
        listByTeam: jest.fn((teamId: string) =>
          Promise.resolve(
            teamId === 'team-a' ? [{ id: 'p-1' }] : [{ id: 'p-2' }],
          ),
        ),
      },
    });

    await expect(service.sweep()).resolves.toBeUndefined();
    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledWith(
      'team-a',
      [teamARow],
    );
    expect(accountErasureService.executeTeamCascade).toHaveBeenCalledWith(
      'team-b',
      [teamBRow],
    );
  });

  // k8s/README.md's now-resolved "Scheduled-job races" note — with 2+ api
  // replicas, only the one that wins the Redis try-lock should run.
  it("skips entirely when another replica already claimed this run's lock", async () => {
    const { service, accountErasureService, redisService } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest.fn().mockResolvedValue(false),
      },
    });

    await service.sweep();

    expect(redisService.tryClaimScheduledJobRun).toHaveBeenCalledWith(
      'account-erasure:sweep',
      expect.any(Number),
    );
    expect(accountErasureService.findDueRows).not.toHaveBeenCalled();
  });

  // code-critic's review of the replicas:2 fix — a rejected run-lock check
  // (e.g. Redis briefly unreachable) must degrade the same as "lost the
  // claim" (skip this tick), not crash the whole sweep.
  it('skips this tick, without throwing, if the Redis run-lock check itself fails', async () => {
    const { service, accountErasureService } = buildService({
      redisService: {
        tryClaimScheduledJobRun: jest
          .fn()
          .mockRejectedValue(new Error('redis unreachable')),
      },
    });

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(accountErasureService.findDueRows).not.toHaveBeenCalled();
  });
});
