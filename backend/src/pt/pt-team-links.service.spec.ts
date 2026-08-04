import { EntityManager } from 'typeorm';
import {
  PtInviteCodeInvalidException,
  PtTeamLinkAlreadyActiveException,
  PtTeamLinkNotFoundException,
} from '../common/errors/exceptions';
import {
  PtPlayerConsent,
  PtPlayerConsentRevokedReason,
  PtPlayerConsentStatus,
} from './entities/pt-player-consent.entity';
import { PtTeamLink, PtTeamLinkStatus } from './entities/pt-team-link.entity';
import { PtTeamLinksService } from './pt-team-links.service';

function fakeLinkQueryBuilder(result: PtTeamLink | null) {
  const qb = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
  return qb;
}

function fakeUpdateQueryBuilder(affected: number) {
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  return qb;
}

function buildService(overrides: {
  ptTeamLinkRepository?: Record<string, jest.Mock>;
  staffAccountRepository?: Record<string, jest.Mock>;
  playersService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
  linkQueryBuilder?: ReturnType<typeof fakeLinkQueryBuilder>;
  consentUpdateQueryBuilder?: ReturnType<typeof fakeUpdateQueryBuilder>;
}) {
  const ptTeamLinkRepository = {
    save: jest.fn((entity: Partial<PtTeamLink>) =>
      Promise.resolve({
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        revokedAt: null,
        ...entity,
      }),
    ),
    create: jest.fn((entity: unknown) => entity),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides.ptTeamLinkRepository,
  };
  const staffAccountRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue({ email: 'pt@example.com', displayName: 'Coach PT' }),
    ...overrides.staffAccountRepository,
  };
  const playersService = {
    assertIsCaptainOfTeam: jest.fn().mockResolvedValue(undefined),
    ...overrides.playersService,
  };
  const redisService = {
    storePtTeamLinkInviteCode: jest.fn().mockResolvedValue(true),
    redeemPtTeamLinkInviteCode: jest.fn().mockResolvedValue({
      teamId: 'team-1',
      invitedByPlayerId: 'captain-1',
    }),
    ...overrides.redisService,
  };

  const linkQueryBuilder =
    overrides.linkQueryBuilder ??
    fakeLinkQueryBuilder({
      id: 'link-1',
      teamId: 'team-1',
      ptStaffAccountId: 'pt-1',
      status: PtTeamLinkStatus.ACTIVE,
      revokedAt: null,
    } as PtTeamLink);
  const consentUpdateQueryBuilder =
    overrides.consentUpdateQueryBuilder ?? fakeUpdateQueryBuilder(2);

  const managerLinkRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(linkQueryBuilder),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
  };
  const managerConsentRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(consentUpdateQueryBuilder),
  };

  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === PtTeamLink) return managerLinkRepository;
      if (entity === PtPlayerConsent) return managerConsentRepository;
      throw new Error('Unexpected repository requested in test');
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (manager: EntityManager) => unknown) =>
      cb(manager),
    ),
  };

  const service = new PtTeamLinksService(
    dataSource as never,
    playersService as never,
    redisService as never,
    ptTeamLinkRepository as never,
    staffAccountRepository as never,
  );

  return {
    service,
    ptTeamLinkRepository,
    staffAccountRepository,
    playersService,
    redisService,
    linkQueryBuilder,
    consentUpdateQueryBuilder,
    managerLinkRepository,
  };
}

describe('PtTeamLinksService.generateInvite', () => {
  it('requires the requester to be captain of the team', async () => {
    const { service, playersService, redisService } = buildService({});
    await service.generateInvite('captain-1', 'team-1');
    expect(playersService.assertIsCaptainOfTeam).toHaveBeenCalledWith(
      'captain-1',
      'team-1',
    );
    expect(redisService.storePtTeamLinkInviteCode).toHaveBeenCalledWith(
      expect.any(String),
      { teamId: 'team-1', invitedByPlayerId: 'captain-1' },
    );
  });
});

describe('PtTeamLinksService.redeemInvite', () => {
  it('throws PtInviteCodeInvalidException for an unknown/expired/already-redeemed code', async () => {
    const { service } = buildService({
      redisService: {
        redeemPtTeamLinkInviteCode: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(
      service.redeemInvite('pt-1', 'BADCODE1'),
    ).rejects.toBeInstanceOf(PtInviteCodeInvalidException);
  });

  it('creates a PtTeamLink row from the redeemed invite payload', async () => {
    const { service, ptTeamLinkRepository } = buildService({});
    const result = await service.redeemInvite('pt-1', 'GOODCODE');
    expect(ptTeamLinkRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        ptStaffAccountId: 'pt-1',
        invitedByPlayerId: 'captain-1',
        status: PtTeamLinkStatus.ACTIVE,
      }),
    );
    expect(result.ptEmail).toBe('pt@example.com');
  });

  it('translates the one-active-link-per-(team,pt) unique violation into PtTeamLinkAlreadyActiveException', async () => {
    const { service } = buildService({
      ptTeamLinkRepository: {
        save: jest.fn().mockRejectedValue({
          code: '23505',
          constraint: 'idx_pt_team_link_one_active_per_team_pt',
        }),
      },
    });
    await expect(
      service.redeemInvite('pt-1', 'GOODCODE'),
    ).rejects.toBeInstanceOf(PtTeamLinkAlreadyActiveException);
  });
});

describe('PtTeamLinksService.revoke', () => {
  it('throws PtTeamLinkNotFoundException when there is no matching active link', async () => {
    const { service } = buildService({
      linkQueryBuilder: fakeLinkQueryBuilder(null),
    });
    await expect(
      service.revoke('captain-1', 'team-1', 'link-1'),
    ).rejects.toBeInstanceOf(PtTeamLinkNotFoundException);
  });

  it('cascade-revokes every pending_review/approved PtPlayerConsent rooted under the revoked link', async () => {
    const { service, managerLinkRepository, consentUpdateQueryBuilder } =
      buildService({});

    const result = await service.revoke('captain-1', 'team-1', 'link-1');

    // The link itself is flipped to revoked.
    expect(managerLinkRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PtTeamLinkStatus.REVOKED }),
    );
    // The cascade UPDATE targets exactly this link's consents, in
    // pending_review/approved, with revoked_reason = team_link_revoked.
    expect(consentUpdateQueryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PtPlayerConsentStatus.REVOKED,
        revokedReason: PtPlayerConsentRevokedReason.TEAM_LINK_REVOKED,
      }),
    );
    expect(consentUpdateQueryBuilder.where).toHaveBeenCalledWith(
      'pt_team_link_id = :linkId',
      { linkId: 'link-1' },
    );
    expect(consentUpdateQueryBuilder.andWhere).toHaveBeenCalledWith(
      'status IN (:...statuses)',
      {
        statuses: [
          PtPlayerConsentStatus.PENDING_REVIEW,
          PtPlayerConsentStatus.APPROVED,
        ],
      },
    );
    expect(result).toEqual({ revoked: true, cascadedConsentCount: 2 });
  });
});
