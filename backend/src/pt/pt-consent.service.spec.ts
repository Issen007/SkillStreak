import { consentTrainerEmail, consentTrainerName } from './pt-consent.service';
import { EntityManager } from 'typeorm';
import {
  PtConsentAlreadyActiveException,
  PtConsentBlockedPendingContactChangeException,
  PtConsentPendingCapExceededException,
  PtConsentRateLimitedException,
  PtNoActiveTeamLinkException,
  PtPlayerConsentNotFoundException,
} from '../common/errors/exceptions';
import { encryptPii } from '../common/crypto/pii-encryption.util';
import {
  PtPlayerConsent,
  PtPlayerConsentStatus,
} from './entities/pt-player-consent.entity';
import { PtTeamLinkStatus } from './entities/pt-team-link.entity';
import { PtConsentService } from './pt-consent.service';

const TEST_PII_KEY = Buffer.alloc(32, 7).toString('base64');
const TEST_RECIPIENT_SNAPSHOT = encryptPii('parent@example.com', TEST_PII_KEY);

function fakeConsentQueryBuilder(result: Partial<PtPlayerConsent> | null) {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

function buildService(overrides: {
  ptPlayerConsentRepository?: Record<string, jest.Mock>;
  ptTeamLinkRepository?: Record<string, jest.Mock>;
  staffAccountRepository?: Record<string, jest.Mock>;
  playersService?: Record<string, jest.Mock>;
  playerPrivateInfoService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
  mailService?: Record<string, jest.Mock>;
  configService?: Record<string, jest.Mock>;
  consentQueryBuilder?: ReturnType<typeof fakeConsentQueryBuilder>;
}) {
  const ptPlayerConsentRepository = {
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    create: jest.fn((entity: unknown) => entity),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    ...overrides.ptPlayerConsentRepository,
  };
  const ptTeamLinkRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: 'link-1',
      teamId: 'team-1',
      ptStaffAccountId: 'pt-1',
      status: PtTeamLinkStatus.ACTIVE,
    }),
    ...overrides.ptTeamLinkRepository,
  };
  const staffAccountRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue({ email: 'pt@example.com', displayName: 'Coach PT' }),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.staffAccountRepository,
  };
  const playersService = {
    findByIdOrThrow: jest.fn().mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      birthYear: new Date().getUTCFullYear() - 10,
      locale: 'sv',
    }),
    findById: jest.fn().mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      birthYear: new Date().getUTCFullYear() - 10,
      locale: 'sv',
    }),
    ...overrides.playersService,
  };
  const playerPrivateInfoService = {
    hasPendingContactChange: jest.fn().mockResolvedValue(false),
    getParentContact: jest.fn().mockResolvedValue('parent@example.com'),
    ...overrides.playerPrivateInfoService,
  };
  const redisService = {
    tryClaimPtConsentRequestCooldown: jest.fn().mockResolvedValue(true),
    tryClaimPtConsentRequestDailyCap: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };
  const mailService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
    ...overrides.mailService,
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(TEST_PII_KEY),
    get: jest.fn().mockReturnValue(undefined),
    ...overrides.configService,
  };

  const consentQueryBuilder =
    overrides.consentQueryBuilder ??
    fakeConsentQueryBuilder({
      id: 'consent-1',
      ptTeamLinkId: 'link-1',
      ptStaffAccountId: 'pt-1',
      playerId: 'player-1',
      status: PtPlayerConsentStatus.PENDING_REVIEW,
      reviewCode: 'REVIEW01',
      reviewCodeExpiresAt: new Date(Date.now() + 60_000),
      recipientContactSnapshot: TEST_RECIPIENT_SNAPSHOT,
    });

  const managerConsentRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(consentQueryBuilder),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
  };
  const manager = {
    getRepository: jest.fn().mockReturnValue(managerConsentRepository),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (manager: EntityManager) => unknown) =>
      cb(manager),
    ),
  };

  const service = new PtConsentService(
    dataSource as never,
    playersService as never,
    playerPrivateInfoService as never,
    redisService as never,
    mailService as never,
    configService as never,
    ptPlayerConsentRepository as never,
    ptTeamLinkRepository as never,
    staffAccountRepository as never,
  );

  return {
    service,
    ptPlayerConsentRepository,
    ptTeamLinkRepository,
    staffAccountRepository,
    playersService,
    playerPrivateInfoService,
    redisService,
    mailService,
    configService,
    consentQueryBuilder,
    managerConsentRepository,
  };
}

describe('PtConsentService.requestConsent', () => {
  it('refuses with no_active_team_link before any other check when the PT has no active link to the player’s team', async () => {
    const { service, playerPrivateInfoService, redisService } = buildService({
      ptTeamLinkRepository: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.requestConsent('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtNoActiveTeamLinkException);
    expect(
      playerPrivateInfoService.hasPendingContactChange,
    ).not.toHaveBeenCalled();
    expect(
      redisService.tryClaimPtConsentRequestCooldown,
    ).not.toHaveBeenCalled();
  });

  it('refuses with pt_consent_blocked_pending_contact_change before touching rate limits', async () => {
    const { service, redisService } = buildService({
      playerPrivateInfoService: {
        hasPendingContactChange: jest.fn().mockResolvedValue(true),
      },
    });

    await expect(
      service.requestConsent('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtConsentBlockedPendingContactChangeException);
    expect(
      redisService.tryClaimPtConsentRequestCooldown,
    ).not.toHaveBeenCalled();
  });

  it('refuses when an active (pending_review/approved) consent already exists for this (pt, player) pair', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'existing',
          status: PtPlayerConsentStatus.APPROVED,
        }),
      },
    });

    await expect(
      service.requestConsent('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtConsentAlreadyActiveException);
  });

  it('expires a stale pending_review row past its review-code TTL instead of permanently blocking a re-request (code-critic finding)', async () => {
    const staleRow: Partial<PtPlayerConsent> = {
      id: 'stale-consent',
      ptStaffAccountId: 'pt-1',
      playerId: 'player-1',
      status: PtPlayerConsentStatus.PENDING_REVIEW,
      reviewCodeExpiresAt: new Date(Date.now() - 60_000),
    };
    const { service, ptPlayerConsentRepository } = buildService({
      ptPlayerConsentRepository: {
        findOne: jest.fn().mockResolvedValue(staleRow),
      },
    });

    const result = await service.requestConsent('pt-1', 'player-1');

    expect(ptPlayerConsentRepository.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'stale-consent',
        status: PtPlayerConsentStatus.EXPIRED,
      }),
    );
    expect(ptPlayerConsentRepository.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ptStaffAccountId: 'pt-1',
        playerId: 'player-1',
        status: PtPlayerConsentStatus.PENDING_REVIEW,
      }),
    );
    expect(result.requested).toBe(true);
  });

  it('still refuses when an existing pending_review row has not yet expired', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'live-consent',
          status: PtPlayerConsentStatus.PENDING_REVIEW,
          reviewCodeExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await expect(
      service.requestConsent('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtConsentAlreadyActiveException);
  });

  it('is rate-limited by the burst cooldown', async () => {
    const { service } = buildService({
      redisService: {
        tryClaimPtConsentRequestCooldown: jest.fn().mockResolvedValue(false),
      },
    });
    await expect(
      service.requestConsent('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtConsentRateLimitedException);
  });

  it('is rejected once the global pending-request cap is reached', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: { count: jest.fn().mockResolvedValue(20) },
    });
    await expect(
      service.requestConsent('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtConsentPendingCapExceededException);
  });

  it('persists a pending_review row scoped to the active team link and sends the request email', async () => {
    const { service, ptPlayerConsentRepository, mailService } = buildService(
      {},
    );

    const result = await service.requestConsent('pt-1', 'player-1');

    expect(ptPlayerConsentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ptTeamLinkId: 'link-1',
        ptStaffAccountId: 'pt-1',
        playerId: 'player-1',
        status: PtPlayerConsentStatus.PENDING_REVIEW,
      }),
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com' }),
    );
    expect(result.requested).toBe(true);
  });
});

describe('PtConsentService.getConsentStatus (security-reviewer Finding 6)', () => {
  it('requires the identical active-team-link check as the write endpoint', async () => {
    const { service } = buildService({
      ptTeamLinkRepository: { findOne: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.getConsentStatus('pt-1', 'player-1'),
    ).rejects.toBeInstanceOf(PtNoActiveTeamLinkException);
  });

  it('returns none when no active consent row exists', async () => {
    const { service } = buildService({});
    await expect(service.getConsentStatus('pt-1', 'player-1')).resolves.toEqual(
      {
        status: 'none',
      },
    );
  });

  it('returns the current active status otherwise', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        findOne: jest
          .fn()
          .mockResolvedValue({ status: PtPlayerConsentStatus.APPROVED }),
      },
    });
    await expect(service.getConsentStatus('pt-1', 'player-1')).resolves.toEqual(
      {
        status: 'approved',
      },
    );
  });
});

describe('PtConsentService.approveByReviewCode', () => {
  it('returns null for an invalid/expired/already-decided code', async () => {
    const { service } = buildService({
      consentQueryBuilder: fakeConsentQueryBuilder(null),
    });
    await expect(service.approveByReviewCode('BADCODE1')).resolves.toBeNull();
  });

  it('approves, mints a non-expiring revoke code, and emails the confirmation', async () => {
    const { service, managerConsentRepository, mailService } = buildService({});

    const result = await service.approveByReviewCode('REVIEW01');

    expect(managerConsentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PtPlayerConsentStatus.APPROVED,
        reviewCode: null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        revokeCode: expect.any(String),
      }),
    );
    expect(mailService.sendMail).toHaveBeenCalled();
    expect(result).toEqual({ ptDisplayName: 'Coach PT' });
  });
});

describe('PtConsentService.revokeByRevokeCode (Decision A4 lever 2)', () => {
  it('returns null when there is no matching approved row', async () => {
    const { service } = buildService({
      consentQueryBuilder: fakeConsentQueryBuilder(null),
    });
    await expect(service.revokeByRevokeCode('REVOKECODE')).resolves.toBeNull();
  });

  it('revokes with reason parent_or_player_revoked', async () => {
    const { service, managerConsentRepository } = buildService({
      consentQueryBuilder: fakeConsentQueryBuilder({
        id: 'consent-1',
        status: PtPlayerConsentStatus.APPROVED,
      }),
    });
    const result = await service.revokeByRevokeCode('REVOKECODE');
    expect(result).toEqual({ revoked: true });
    expect(managerConsentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PtPlayerConsentStatus.REVOKED,
        revokedReason: 'parent_or_player_revoked',
      }),
    );
  });
});

describe('PtConsentService.playerSelfRevoke (Decision A4 lever 1)', () => {
  it('throws PtPlayerConsentNotFoundException when the id is not owned by (or not active for) this player', async () => {
    const { service } = buildService({
      consentQueryBuilder: fakeConsentQueryBuilder(null),
    });
    await expect(
      service.playerSelfRevoke('player-1', 'consent-1'),
    ).rejects.toBeInstanceOf(PtPlayerConsentNotFoundException);
  });

  it('revokes the caller’s own consent, no parent action required', async () => {
    const { service, managerConsentRepository } = buildService({
      consentQueryBuilder: fakeConsentQueryBuilder({
        id: 'consent-1',
        playerId: 'player-1',
        status: PtPlayerConsentStatus.APPROVED,
      }),
    });
    const result = await service.playerSelfRevoke('player-1', 'consent-1');
    expect(result).toEqual({ revoked: true });
    expect(managerConsentRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PtPlayerConsentStatus.REVOKED,
        revokedReason: 'parent_or_player_revoked',
      }),
    );
  });
});

// Screen PL1's list (docs/design/phase8-pt-flows.md §7). The read side of
// Decision A4's self-service revoke lever, which shipped without one — a
// child could revoke, but never see what.
describe('PtConsentService.listOwnConsents', () => {
  const rows = [
    {
      id: 'consent-1',
      ptStaffAccountId: 'pt-1',
      status: PtPlayerConsentStatus.APPROVED,
      decidedAt: new Date('2026-06-12T00:00:00.000Z'),
      revokedAt: null,
    },
    {
      id: 'consent-2',
      ptStaffAccountId: 'pt-2',
      status: PtPlayerConsentStatus.REVOKED,
      decidedAt: new Date('2026-05-01T00:00:00.000Z'),
      revokedAt: new Date('2026-08-02T00:00:00.000Z'),
    },
  ];

  it('returns the player’s own relationships with the PT’s display name resolved', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        find: jest.fn().mockResolvedValue(rows),
      },
      staffAccountRepository: {
        find: jest.fn().mockResolvedValue([
          { id: 'pt-1', displayName: 'Anna Svensson', email: 'a@x.se' },
          { id: 'pt-2', displayName: 'Jonas Berg', email: 'j@x.se' },
        ]),
      },
    });

    await expect(service.listOwnConsents('player-1')).resolves.toEqual([
      {
        id: 'consent-1',
        ptDisplayName: 'Anna Svensson',
        status: PtPlayerConsentStatus.APPROVED,
        decidedAt: '2026-06-12T00:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'consent-2',
        ptDisplayName: 'Jonas Berg',
        status: PtPlayerConsentStatus.REVOKED,
        decidedAt: '2026-05-01T00:00:00.000Z',
        revokedAt: '2026-08-02T00:00:00.000Z',
      },
    ]);
  });

  // Filtering by the caller's own playerId is the whole authorization
  // story here — there is no id in the request to tamper with.
  it('scopes the query to the caller and omits declined/expired rows', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const { service } = buildService({
      ptPlayerConsentRepository: { find },
    });

    await service.listOwnConsents('player-1');

    const [[criteria]] = find.mock.calls as [
      [{ where: { playerId: string; status: { value: string[] } } }],
    ];
    expect(criteria.where.playerId).toBe('player-1');
    expect(criteria.where.status.value).toEqual([
      PtPlayerConsentStatus.PENDING_REVIEW,
      PtPlayerConsentStatus.APPROVED,
      PtPlayerConsentStatus.REVOKED,
    ]);
    // A declined request is a relationship that never existed; showing a
    // child a stream of requests their parent quietly turned down is not
    // this screen's job.
    expect(criteria.where.status.value).not.toContain(
      PtPlayerConsentStatus.DECLINED,
    );
  });

  it('never queries staff accounts when the player has no relationships', async () => {
    const staffFind = jest.fn().mockResolvedValue([]);
    const { service } = buildService({
      ptPlayerConsentRepository: { find: jest.fn().mockResolvedValue([]) },
      staffAccountRepository: { find: staffFind },
    });

    await expect(service.listOwnConsents('player-1')).resolves.toEqual([]);
    expect(staffFind).not.toHaveBeenCalled();
  });

  // Apple withholds a display name on every login after the first, so an
  // account can legitimately have none. A blank row is unactionable for a
  // child deciding whether to end a relationship.
  it('falls back to the email, then a placeholder, when no display name exists', async () => {
    const { service } = buildService({
      ptPlayerConsentRepository: {
        find: jest
          .fn()
          .mockResolvedValue([
            rows[0],
            { ...rows[1], ptStaffAccountId: 'ghost' },
          ]),
      },
      staffAccountRepository: {
        find: jest
          .fn()
          .mockResolvedValue([
            { id: 'pt-1', displayName: null, email: 'a@x.se' },
          ]),
      },
    });

    const result = await service.listOwnConsents('player-1');

    expect(result[0].ptDisplayName).toBe('a@x.se');
    expect(result[1].ptDisplayName).toBe('—');
  });
});

/**
 * Added 2026-08-11 from ADR-0027's security review, finding 3.
 *
 * The consent record snapshotted the recipient's contact but not the
 * trainer's identity, and every parent- and child-facing render resolved
 * it live from `StaffAccount` — a row whose display_name and email are
 * overwritten from the ID token on every Google/Microsoft login. So the
 * name a parent approved could silently become a different name.
 */
describe('PtConsentService: the trainer identity a parent approved', () => {
  it('prefers the snapshot over the live account row', () => {
    const row = {
      ptDisplayNameSnapshot: 'Anna Trainer',
      ptEmailSnapshot: 'anna@example.se',
    };
    const live = { displayName: 'Someone Else', email: 'other@example.se' };

    expect(consentTrainerName(row, live)).toBe('Anna Trainer');
  });

  it('falls back to the live row only for consents predating the columns', () => {
    const row = { ptDisplayNameSnapshot: null, ptEmailSnapshot: null };
    const live = { displayName: 'Legacy Trainer', email: 'legacy@example.se' };

    expect(consentTrainerName(row, live)).toBe('Legacy Trainer');
  });

  it('uses the snapshotted email when a provider never gave a name', () => {
    // Apple withholds the name on every login after the first, so an
    // account created that way legitimately has none.
    const row = {
      ptDisplayNameSnapshot: null,
      ptEmailSnapshot: 'apple-user@example.se',
    };

    expect(consentTrainerName(row, null)).toBe('apple-user@example.se');
  });

  it('never renders an empty name to a child deciding whether to end it', () => {
    const row = { ptDisplayNameSnapshot: null, ptEmailSnapshot: null };

    expect(consentTrainerName(row, null, '—')).toBe('—');
  });

  it('freezes the email on the same terms as the name beside it', () => {
    // Freezing one and resolving the other live was worse than freezing
    // neither: the review screen could show a name from the moment of the
    // request next to an address from a row every login overwrites.
    const row = {
      ptDisplayNameSnapshot: 'Anna Trainer',
      ptEmailSnapshot: 'anna@example.se',
    };
    const live = { displayName: 'Anna Nynamn', email: 'anna.new@example.se' };

    expect(consentTrainerName(row, live)).toBe('Anna Trainer');
    expect(consentTrainerEmail(row, live)).toBe('anna@example.se');
  });

  it('falls back to the live email only for rows predating the column', () => {
    expect(
      consentTrainerEmail({ ptEmailSnapshot: null }, { email: 'x@example.se' }),
    ).toBe('x@example.se');
  });
});
