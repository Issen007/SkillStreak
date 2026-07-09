import { EntityManager } from 'typeorm';
import {
  CaptainConsentRequiredException,
  CaptainTransferConflictException,
  CaptainTransferTargetNotOnTeamException,
  CaptainTransferToSelfException,
  NotTeamCaptainException,
  PlayerNotFoundException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from './player-consent-status.enum';
import { PlayersService } from './players.service';

// Mirrors weekly-goal.service.spec.ts's "fake manager whose getRepository
// returns a plain jest-mocked repository" shape — PlayersService.
// transferCaptaincy only ever calls manager.getRepository(Player).save, no
// query builder involved (findByIdForUpdate is exercised directly here via
// a stubbed implementation, not through its own query-builder internals,
// since that method already has no dedicated spec and its shape is simple
// enough to stub for this test's purposes).
//
// Every `requester` fixture below that's expected to reach past the
// captain check now needs `parentalConsentStatus: APPROVED` explicitly —
// docs/ACTION_PLAN.md's Phase 2.9 decision added an acting-captain
// consent gate right after the isCaptain check (see
// CaptainConsentRequiredException's own comment).
describe('PlayersService.transferCaptaincy', () => {
  const teamId = 'team-1';
  const requesterId = 'requester-1';
  const targetId = 'target-1';

  function buildService(options: {
    requester: {
      id: string;
      teamId: string;
      isCaptain: boolean;
      parentalConsentStatus?: ParentalConsentStatus;
    };
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
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
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
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
    const { service } = buildService({ requester, target: null });

    await expect(
      service.transferCaptaincy(teamId, requesterId, requesterId),
    ).rejects.toBeInstanceOf(CaptainTransferToSelfException);
  });

  it('rejects with player_not_found when the target does not exist at all', async () => {
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
    const { service } = buildService({ requester, target: null });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(PlayerNotFoundException);
  });

  it('rejects with captain_transfer_target_not_on_team when the target belongs to a different team', async () => {
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
    const target = { id: targetId, teamId: 'other-team', isCaptain: false };
    const { service } = buildService({ requester, target });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(CaptainTransferTargetNotOnTeamException);
  });

  it('rejects with captain_consent_required when the requester is captain but their own consent is not approved', async () => {
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    };
    const target = { id: targetId, teamId, isCaptain: false };
    const { service } = buildService({ requester, target });

    await expect(
      service.transferCaptaincy(teamId, requesterId, targetId),
    ).rejects.toBeInstanceOf(CaptainConsentRequiredException);
  });

  it('translates a idx_player_one_captain_per_team unique violation into captain_transfer_conflict (defensive backstop)', async () => {
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
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
    const requester = {
      id: requesterId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
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

// The shared check reused by weekly-goal create/patch/roster and the
// consent-reminder-resend/session-reissue-trigger services (see each of
// their own tests/e2e coverage for the end-to-end path through this
// method). Exercised directly here since it's the one place the
// acting-captain consent gate is actually implemented.
describe('PlayersService.assertIsCaptainOfTeam', () => {
  const teamId = 'team-1';
  const playerId = 'player-1';

  function buildService(player: {
    id: string;
    teamId: string;
    isCaptain: boolean;
    parentalConsentStatus: ParentalConsentStatus;
  }) {
    const service = new PlayersService(undefined as never, undefined as never);
    jest.spyOn(service, 'findByIdOrThrow').mockResolvedValue(player as never);
    return service;
  }

  it('rejects with not_team_captain when the player is not on this team at all', async () => {
    const service = buildService({
      id: playerId,
      teamId: 'other-team',
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    });

    await expect(
      service.assertIsCaptainOfTeam(playerId, teamId),
    ).rejects.toBeInstanceOf(TeamMismatchException);
  });

  it('rejects with not_team_captain when isCaptain is false, before ever checking consent', async () => {
    const service = buildService({
      id: playerId,
      teamId,
      isCaptain: false,
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    });

    await expect(
      service.assertIsCaptainOfTeam(playerId, teamId),
    ).rejects.toBeInstanceOf(NotTeamCaptainException);
  });

  it("rejects with captain_consent_required when isCaptain is true but the captain's own consent is still pending", async () => {
    const service = buildService({
      id: playerId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    });

    await expect(
      service.assertIsCaptainOfTeam(playerId, teamId),
    ).rejects.toBeInstanceOf(CaptainConsentRequiredException);
  });

  it("rejects with captain_consent_required when the captain's own consent was revoked", async () => {
    const service = buildService({
      id: playerId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.REVOKED,
    });

    await expect(
      service.assertIsCaptainOfTeam(playerId, teamId),
    ).rejects.toBeInstanceOf(CaptainConsentRequiredException);
  });

  it('returns the player when isCaptain is true and their own consent is approved', async () => {
    const player = {
      id: playerId,
      teamId,
      isCaptain: true,
      parentalConsentStatus: ParentalConsentStatus.APPROVED,
    };
    const service = buildService(player);

    await expect(
      service.assertIsCaptainOfTeam(playerId, teamId),
    ).resolves.toEqual(player);
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
