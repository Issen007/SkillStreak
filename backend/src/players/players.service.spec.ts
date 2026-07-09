import { EntityManager } from 'typeorm';
import {
  CaptainTransferConflictException,
  CaptainTransferTargetNotOnTeamException,
  CaptainTransferToSelfException,
  NotTeamCaptainException,
  PlayerNotFoundException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { PlayersService } from './players.service';

// Mirrors weekly-goal.service.spec.ts's "fake manager whose getRepository
// returns a plain jest-mocked repository" shape — PlayersService.
// transferCaptaincy only ever calls manager.getRepository(Player).save, no
// query builder involved (findByIdForUpdate is exercised directly here via
// a stubbed implementation, not through its own query-builder internals,
// since that method already has no dedicated spec and its shape is simple
// enough to stub for this test's purposes).
describe('PlayersService.transferCaptaincy', () => {
  const teamId = 'team-1';
  const requesterId = 'requester-1';
  const targetId = 'target-1';

  function buildService(options: {
    requester: { id: string; teamId: string; isCaptain: boolean };
    target: { id: string; teamId: string; isCaptain: boolean } | null;
    onTargetSave?: () => void | never;
  }) {
    const save = jest.fn((entity: { isCaptain: boolean }) => {
      if (entity === options.target && options.onTargetSave !== undefined) {
        options.onTargetSave();
      }
      return Promise.resolve(entity);
    });

    const repository = { save };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn((cb: (manager: EntityManager) => unknown) =>
        cb(manager),
      ),
    };

    const service = new PlayersService(dataSource as never, undefined as never);

    // Stub findByIdForUpdate directly (its own lock/throw behavior is
    // exercised implicitly by the fact PlayerNotFoundException already
    // exists as its documented contract — see the class's own comment) so
    // this suite can focus purely on transferCaptaincy's authorization/
    // transaction logic.
    jest
      .spyOn(service, 'findByIdForUpdate')
      .mockImplementation((_manager, playerId) => {
        if (playerId === requesterId) {
          return Promise.resolve(options.requester as never);
        }
        if (playerId === targetId) {
          if (!options.target)
            return Promise.reject(new PlayerNotFoundException());
          return Promise.resolve(options.target as never);
        }
        return Promise.reject(new PlayerNotFoundException());
      });

    return { service, save, dataSource };
  }

  it('flips the flag from requester to target on a legal transfer', async () => {
    const requester = { id: requesterId, teamId, isCaptain: true };
    const target = { id: targetId, teamId, isCaptain: false };
    const { service } = buildService({ requester, target });

    const result = await service.transferCaptaincy(
      teamId,
      requesterId,
      targetId,
    );

    expect(requester.isCaptain).toBe(false);
    expect(target.isCaptain).toBe(true);
    expect(result).toEqual({
      teamId,
      previousCaptainPlayerId: requesterId,
      newCaptainPlayerId: targetId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      transferredAt: expect.any(Date),
    });
  });

  it('rejects with team_mismatch when the requester is not on this team', async () => {
    const requester = {
      id: requesterId,
      teamId: 'other-team',
      isCaptain: true,
    };
    const target = { id: targetId, teamId, isCaptain: false };
    const { service } = buildService({ requester, target });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(TeamMismatchException);
  });

  it('rejects with not_team_captain when the requester is not the current captain — this is the race the row lock closes', async () => {
    const requester = { id: requesterId, teamId, isCaptain: false };
    const target = { id: targetId, teamId, isCaptain: false };
    const { service } = buildService({ requester, target });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(NotTeamCaptainException);
  });

  it('rejects a captain "transferring" to themselves with captain_transfer_target_is_self', async () => {
    const requester = { id: requesterId, teamId, isCaptain: true };
    const { service } = buildService({ requester, target: null });

    await expect(
      service.transferCaptaincy(teamId, requesterId, requesterId),
    ).rejects.toBeInstanceOf(CaptainTransferToSelfException);
  });

  it('rejects with player_not_found when the target does not exist at all', async () => {
    const requester = { id: requesterId, teamId, isCaptain: true };
    const { service } = buildService({ requester, target: null });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(PlayerNotFoundException);
  });

  it('rejects with captain_transfer_target_not_on_team when the target belongs to a different team', async () => {
    const requester = { id: requesterId, teamId, isCaptain: true };
    const target = { id: targetId, teamId: 'other-team', isCaptain: false };
    const { service } = buildService({ requester, target });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(CaptainTransferTargetNotOnTeamException);
  });

  it('translates a idx_player_one_captain_per_team unique violation into captain_transfer_conflict (defensive backstop)', async () => {
    const requester = { id: requesterId, teamId, isCaptain: true };
    const target = { id: targetId, teamId, isCaptain: false };
    const { service } = buildService({
      requester,
      target,
      onTargetSave: () => {
        const error = new Error('duplicate key value') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'idx_player_one_captain_per_team';
        throw error;
      },
    });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(CaptainTransferConflictException);
  });

  it('re-throws an unrelated error from the target save unchanged', async () => {
    const requester = { id: requesterId, teamId, isCaptain: true };
    const target = { id: targetId, teamId, isCaptain: false };
    const boom = new Error('boom');
    const { service } = buildService({
      requester,
      target,
      onTargetSave: () => {
        throw boom;
      },
    });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBe(boom);
  });
});

describe('PlayersService.listTeammates', () => {
  it('maps listByTeam rows to the narrow teammate shape (no consentStatus/lastTrainedDate)', async () => {
    const teamId = 'team-1';
    const requesterId = 'player-1';

    const service = new PlayersService(undefined as never, undefined as never);
    jest.spyOn(service, 'assertTeamMembership').mockResolvedValue({
      id: requesterId,
      teamId,
    } as never);
    jest.spyOn(service, 'listByTeam').mockResolvedValue([
      {
        id: 'player-1',
        screenName: 'FloorballStar15',
        avatarId: 'fox',
        isCaptain: true,
      },
      {
        id: 'player-2',
        screenName: 'Other',
        avatarId: 'wolf',
        isCaptain: false,
      },
    ] as never);

    const result = await service.listTeammates(teamId, requesterId);

    expect(result).toEqual([
      {
        playerId: 'player-1',
        screenName: 'FloorballStar15',
        avatarId: 'fox',
        isCaptain: true,
      },
      {
        playerId: 'player-2',
        screenName: 'Other',
        avatarId: 'wolf',
        isCaptain: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /consentStatus|lastTrainedDate|realName/i,
    );
  });
});
