import { EntityManager } from 'typeorm';
import {
  ErasureAlreadyActiveException,
  ErasureBlockedPendingContactChangeException,
  ErasureRateLimitedException,
  ErasureRequestNotActiveException,
  ErasureSuccessorInvalidException,
  ErasureSuccessorNotAllowedException,
  ErasureSuccessorRequiredException,
} from '../common/errors/exceptions';
import { encryptPii } from '../common/crypto/pii-encryption.util';
import { AccountErasureService } from './account-erasure.service';
import { AccountErasureStatus } from './entities/account-erasure-request.entity';
import * as successorValidation from './successor-validation.util';

jest.mock('./successor-validation.util', () => ({
  isSuccessorStillValid: jest.fn(),
}));

const isSuccessorStillValidMock =
  successorValidation.isSuccessorStillValid as jest.Mock;

// A real (valid, decryptable) key/ciphertext pair — several tests below
// exercise sendCancelEmailBestEffort, which really decrypts
// recipientContactSnapshot, so a placeholder string like 'encrypted-blob'
// isn't good enough (AES-256-GCM auth-tag verification fails on garbage
// input, by design — see pii-encryption.util.ts).
const TEST_PII_KEY = Buffer.alloc(32, 7).toString('base64');
const TEST_RECIPIENT_SNAPSHOT = encryptPii('parent@example.com', TEST_PII_KEY);

/** A generic fake repository supporting every method any of
 * AccountErasureService's `manager.getRepository(X)` call sites use across
 * its various transactions (create/save/find/findOne/update/delete/
 * createQueryBuilder) — the default returned by the fake manager below,
 * so tests that don't care about a *specific* entity's repository shape
 * (e.g. executeSingleErasure/executeTeamCascade's TeamChatMessage/
 * Challenge/VideoClip/Player/AccountErasureRequest updates) don't each need
 * to hand-roll one. */
function genericRepo(overrides: Record<string, jest.Mock> = {}) {
  return {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
    ...overrides,
  };
}

function buildService(overrides: {
  accountErasureRequestRepository?: Record<string, jest.Mock>;
  videoClipRepository?: Record<string, jest.Mock>;
  playersService?: Record<string, jest.Mock>;
  playerPrivateInfoService?: Record<string, jest.Mock>;
  objectStorageService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
  mailService?: Record<string, jest.Mock>;
  configService?: Record<string, jest.Mock>;
  manager?: Record<string, jest.Mock>;
}) {
  const accountErasureRequestRepository = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(),
    ...overrides.accountErasureRequestRepository,
  };
  const videoClipRepository = {
    find: jest.fn().mockResolvedValue([]),
    ...overrides.videoClipRepository,
  };
  const playersService = {
    findByIdOrThrow: jest.fn().mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      isCaptain: false,
    }),
    findById: jest.fn().mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      isCaptain: false,
    }),
    listByTeam: jest.fn().mockResolvedValue([{ id: 'player-1' }]),
    applyDeferredCaptainHandoff: jest.fn().mockResolvedValue(undefined),
    findAutoFallbackCaptainCandidate: jest.fn().mockResolvedValue(null),
    ...overrides.playersService,
  };
  const playerPrivateInfoService = {
    hasPendingContactChange: jest.fn().mockResolvedValue(false),
    getParentContact: jest.fn().mockResolvedValue('parent@example.com'),
    ...overrides.playerPrivateInfoService,
  };
  const objectStorageService = {
    deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
    ...overrides.objectStorageService,
  };
  const redisService = {
    tryClaimErasureRequestCooldown: jest.fn().mockResolvedValue(true),
    tryClaimErasureRequestDailyCap: jest.fn().mockResolvedValue(true),
    removeFromLeaderboard: jest.fn().mockResolvedValue(undefined),
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

  const manager = {
    getRepository: jest.fn().mockReturnValue(genericRepo()),
    ...overrides.manager,
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((cb: (manager: EntityManager) => unknown) =>
      cb(manager),
    ),
    manager,
  };

  const service = new AccountErasureService(
    dataSource as never,
    accountErasureRequestRepository as never,
    videoClipRepository as never,
    playersService as never,
    playerPrivateInfoService as never,
    objectStorageService as never,
    redisService as never,
    mailService as never,
    configService as never,
  );

  return {
    service,
    accountErasureRequestRepository,
    videoClipRepository,
    playersService,
    playerPrivateInfoService,
    objectStorageService,
    redisService,
    mailService,
    configService,
    dataSource,
    manager,
  };
}

beforeEach(() => {
  isSuccessorStillValidMock.mockReset();
});

describe('AccountErasureService.requestErasure', () => {
  it('refuses with erasure_blocked_pending_contact_change before touching rate limits or the DB (Decision 2)', async () => {
    const { service, redisService, accountErasureRequestRepository } =
      buildService({
        playerPrivateInfoService: {
          hasPendingContactChange: jest.fn().mockResolvedValue(true),
        },
      });

    await expect(service.requestErasure('player-1')).rejects.toBeInstanceOf(
      ErasureBlockedPendingContactChangeException,
    );
    expect(redisService.tryClaimErasureRequestCooldown).not.toHaveBeenCalled();
    expect(accountErasureRequestRepository.save).not.toHaveBeenCalled();
  });

  it('requires successorPlayerId when the caller is captain with >=1 teammate', async () => {
    const { service } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'player-1',
          teamId: 'team-1',
          screenName: 'Cap',
          isCaptain: true,
        }),
        listByTeam: jest
          .fn()
          .mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }]),
      },
    });

    await expect(service.requestErasure('player-1')).rejects.toBeInstanceOf(
      ErasureSuccessorRequiredException,
    );
  });

  it('forbids successorPlayerId when the caller is not captain (or is captain but the last player)', async () => {
    const { service } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'player-1',
          teamId: 'team-1',
          screenName: 'Solo',
          isCaptain: true,
        }),
        listByTeam: jest.fn().mockResolvedValue([{ id: 'player-1' }]),
      },
    });

    await expect(
      service.requestErasure('player-1', 'some-successor'),
    ).rejects.toBeInstanceOf(ErasureSuccessorNotAllowedException);
  });

  it('rejects an invalid successorPlayerId (not on team / self / mid-erasure)', async () => {
    isSuccessorStillValidMock.mockResolvedValue(false);
    const { service } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: 'player-1',
          teamId: 'team-1',
          screenName: 'Cap',
          isCaptain: true,
        }),
        listByTeam: jest
          .fn()
          .mockResolvedValue([{ id: 'player-1' }, { id: 'player-2' }]),
      },
    });

    await expect(
      service.requestErasure('player-1', 'player-2'),
    ).rejects.toBeInstanceOf(ErasureSuccessorInvalidException);
  });

  it('throws erasure_rate_limited on a burst-cooldown failure, before touching the DB', async () => {
    const { service, accountErasureRequestRepository } = buildService({
      redisService: {
        tryClaimErasureRequestCooldown: jest.fn().mockResolvedValue(false),
      },
    });

    await expect(service.requestErasure('player-1')).rejects.toBeInstanceOf(
      ErasureRateLimitedException,
    );
    expect(accountErasureRequestRepository.save).not.toHaveBeenCalled();
  });

  it('throws erasure_rate_limited once the daily cap is exhausted', async () => {
    const { service } = buildService({
      redisService: {
        tryClaimErasureRequestDailyCap: jest.fn().mockResolvedValue(false),
      },
    });

    await expect(service.requestErasure('player-1')).rejects.toBeInstanceOf(
      ErasureRateLimitedException,
    );
  });

  it('resolves parentContact exactly once, stores it encrypted, and emails a confirm link — never leaks the raw code in its response', async () => {
    const { service, playerPrivateInfoService, mailService } = buildService({});

    const result = await service.requestErasure('player-1');

    expect(result.requested).toBe(true);
    expect(playerPrivateInfoService.getParentContact).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com' }),
    );
    expect(JSON.stringify(result)).not.toMatch(/[0-9A-Z]{8}/);
  });

  it('translates the partial-unique-index race into erasure_already_active', async () => {
    const { service } = buildService({
      accountErasureRequestRepository: {
        create: jest.fn((entity: unknown) => entity),
        save: jest.fn().mockRejectedValue(
          Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'idx_account_erasure_request_one_active_per_player',
          }),
        ),
      },
    });

    await expect(service.requestErasure('player-1')).rejects.toBeInstanceOf(
      ErasureAlreadyActiveException,
    );
  });

  it('a mail-send failure does not fail the request — the row already committed', async () => {
    const { service } = buildService({
      mailService: { sendMail: jest.fn().mockRejectedValue(new Error('down')) },
    });

    await expect(service.requestErasure('player-1')).resolves.toMatchObject({
      requested: true,
    });
  });

  it('skips the confirm email (but still succeeds) when there is no parent contact on file', async () => {
    const { service, mailService } = buildService({
      playerPrivateInfoService: {
        getParentContact: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.requestErasure('player-1')).resolves.toMatchObject({
      requested: true,
    });
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});

describe('AccountErasureService.confirmErasure', () => {
  function activeRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'erasure-1',
      playerId: 'player-1',
      teamId: 'team-1',
      status: AccountErasureStatus.REQUESTED,
      confirmCode: 'ABCD1234',
      confirmCodeExpiresAt: new Date(Date.now() + 60_000),
      successorPlayerId: null,
      recipientContactSnapshot: TEST_RECIPIENT_SNAPSHOT,
      ...overrides,
    };
  }

  function buildConfirmQueryBuilder(row: unknown) {
    return {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(row),
    };
  }

  it('returns null for an unknown/expired/already-confirmed code (friendly no-op, not a thrown error)', async () => {
    const qb = buildConfirmQueryBuilder(null);
    const { service } = buildService({
      manager: {
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(qb),
        }),
      },
    });

    await expect(service.confirmErasure('NOPE0000')).resolves.toBeNull();
  });

  it('starts the grace period, clears the confirm code, and emails the cancel link to the snapshotted recipient', async () => {
    const row = activeRow();
    const qb = buildConfirmQueryBuilder(row);
    const savedRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };
    const { service, mailService, playerPrivateInfoService } = buildService({
      manager: { getRepository: jest.fn().mockReturnValue(savedRepo) },
    });

    const result = await service.confirmErasure('ABCD1234');

    expect(result).toEqual({
      confirmed: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      scheduledFor: expect.any(String),
    });
    expect(row.status).toBe(AccountErasureStatus.GRACE_PERIOD);
    expect(row.confirmCode).toBeNull();
    // Decision 2 — never re-resolved from PlayerPrivateInfoService; the
    // cancel-link email uses the row's own stored snapshot instead.
    expect(playerPrivateInfoService.getParentContact).not.toHaveBeenCalled();
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('clears an invalid named successor to null rather than failing the confirm (Decision 4)', async () => {
    isSuccessorStillValidMock.mockResolvedValue(false);
    const row = activeRow({ successorPlayerId: 'stale-successor' });
    const qb = buildConfirmQueryBuilder(row);
    const savedRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };
    const { service } = buildService({
      manager: { getRepository: jest.fn().mockReturnValue(savedRepo) },
    });

    await expect(service.confirmErasure('ABCD1234')).resolves.toMatchObject({
      confirmed: true,
    });
    expect(row.successorPlayerId).toBeNull();
  });

  it('keeps a still-valid named successor', async () => {
    isSuccessorStillValidMock.mockResolvedValue(true);
    const row = activeRow({ successorPlayerId: 'good-successor' });
    const qb = buildConfirmQueryBuilder(row);
    const savedRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };
    const { service } = buildService({
      manager: { getRepository: jest.fn().mockReturnValue(savedRepo) },
    });

    await service.confirmErasure('ABCD1234');
    expect(row.successorPlayerId).toBe('good-successor');
  });
});

describe('AccountErasureService.cancel (authenticated, primary path)', () => {
  it('cancels an active request', async () => {
    const row = {
      status: AccountErasureStatus.GRACE_PERIOD,
      cancelledAt: null as Date | null,
      cancelCode: 'X',
      confirmCode: null,
      confirmCodeExpiresAt: null,
    };
    const qb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(row),
    };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };
    const { service } = buildService({
      manager: { getRepository: jest.fn().mockReturnValue(repo) },
    });

    await expect(service.cancel('player-1')).resolves.toEqual({
      cancelled: true,
    });
    expect(row.status).toBe(AccountErasureStatus.CANCELLED);
    expect(row.cancelCode).toBeNull();
  });

  it('throws erasure_request_not_active when there is nothing to cancel', async () => {
    const qb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const { service } = buildService({
      manager: { getRepository: jest.fn().mockReturnValue(repo) },
    });

    await expect(service.cancel('player-1')).rejects.toBeInstanceOf(
      ErasureRequestNotActiveException,
    );
  });
});

describe('AccountErasureService.executeSingleErasure', () => {
  it('purges MinIO objects before deleting rows, and does not attempt any captain flip for a non-captain', async () => {
    const row = {
      id: 'erasure-1',
      playerId: 'player-1',
      teamId: 'team-1',
      successorPlayerId: null,
    } as never;
    const {
      service,
      objectStorageService,
      playersService,
      videoClipRepository,
    } = buildService({
      videoClipRepository: {
        find: jest.fn().mockResolvedValue([{ storageKey: 'clips/a/b.mp4' }]),
      },
      playersService: {
        findByIdOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'player-1', isCaptain: false }),
        applyDeferredCaptainHandoff: jest.fn(),
      },
    });

    await service.executeSingleErasure(row, []);

    expect(objectStorageService.deleteObjectIfExists).toHaveBeenCalledWith(
      'clips/a/b.mp4',
    );
    expect(playersService.applyDeferredCaptainHandoff).not.toHaveBeenCalled();
    expect(videoClipRepository.find).toHaveBeenCalledWith({
      where: { uploaderPlayerId: 'player-1' },
    });
  });

  it('flips captaincy to the still-valid named successor before the main execution transaction, for a captain', async () => {
    isSuccessorStillValidMock.mockResolvedValue(true);
    const row = {
      id: 'erasure-1',
      playerId: 'player-1',
      teamId: 'team-1',
      successorPlayerId: 'successor-1',
    } as never;
    const { service, playersService } = buildService({
      playersService: {
        findByIdOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'player-1', isCaptain: true }),
        applyDeferredCaptainHandoff: jest.fn().mockResolvedValue(undefined),
        findAutoFallbackCaptainCandidate: jest.fn(),
      },
    });

    await service.executeSingleErasure(row, []);

    expect(playersService.applyDeferredCaptainHandoff).toHaveBeenCalledWith(
      'team-1',
      'player-1',
      'successor-1',
    );
    expect(
      playersService.findAutoFallbackCaptainCandidate,
    ).not.toHaveBeenCalled();
  });

  it('falls back to PlayersService.findAutoFallbackCaptainCandidate when no named successor is (still) valid', async () => {
    isSuccessorStillValidMock.mockResolvedValue(false);
    const row = {
      id: 'erasure-1',
      playerId: 'player-1',
      teamId: 'team-1',
      successorPlayerId: 'stale-successor',
    } as never;
    const { service, playersService } = buildService({
      playersService: {
        findByIdOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'player-1', isCaptain: true }),
        applyDeferredCaptainHandoff: jest.fn().mockResolvedValue(undefined),
        findAutoFallbackCaptainCandidate: jest
          .fn()
          .mockResolvedValue({ id: 'fallback-1' }),
      },
    });

    await service.executeSingleErasure(row, ['other-batch-player']);

    expect(
      playersService.findAutoFallbackCaptainCandidate,
    ).toHaveBeenCalledWith('team-1', ['other-batch-player', 'player-1']);
    expect(playersService.applyDeferredCaptainHandoff).toHaveBeenCalledWith(
      'team-1',
      'player-1',
      'fallback-1',
    );
  });

  it('ZREMs the leaderboard entry after the execution transaction commits', async () => {
    const row = {
      id: 'erasure-1',
      playerId: 'player-1',
      teamId: 'team-1',
      successorPlayerId: null,
    } as never;
    const { service, redisService } = buildService({
      playersService: {
        findByIdOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'player-1', isCaptain: false }),
      },
    });

    await service.executeSingleErasure(row, []);

    expect(redisService.removeFromLeaderboard).toHaveBeenCalledWith(
      'team-1',
      'player-1',
    );
  });
});

describe('AccountErasureService.executeTeamCascade', () => {
  it('purges every clip in the team, deletes the team, marks the whole batch executed, and ZREMs every batch member', async () => {
    const batchRows = [
      { id: 'e-1', playerId: 'p-1', teamId: 'team-1' },
      { id: 'e-2', playerId: 'p-2', teamId: 'team-1' },
    ] as never[];
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const updateMock = jest.fn().mockResolvedValue(undefined);
    const { service, objectStorageService, redisService } = buildService({
      videoClipRepository: {
        find: jest
          .fn()
          .mockResolvedValue([
            { storageKey: 'clips/team-1/a.mp4' },
            { storageKey: 'clips/team-1/b.mp4' },
          ]),
      },
      manager: {
        getRepository: jest
          .fn()
          .mockReturnValue({ delete: deleteMock, update: updateMock }),
      },
    });

    await service.executeTeamCascade('team-1', batchRows);

    expect(objectStorageService.deleteObjectIfExists).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledWith({ id: 'team-1' });
    expect(redisService.removeFromLeaderboard).toHaveBeenCalledWith(
      'team-1',
      'p-1',
    );
    expect(redisService.removeFromLeaderboard).toHaveBeenCalledWith(
      'team-1',
      'p-2',
    );
  });
});
