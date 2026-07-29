import { PlayerPrivateInfoService } from './player-private-info.service';

function buildService(overrides: {
  privateInfoRepository?: Record<string, jest.Mock>;
}) {
  const privateInfoRepository = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.privateInfoRepository,
  };
  const consentRecordRepository = {
    save: jest.fn(),
    create: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('a'.repeat(44)), // unused by this test
  };
  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(undefined)),
  };

  const service = new PlayerPrivateInfoService(
    privateInfoRepository as never,
    consentRecordRepository as never,
    configService as never,
    dataSource as never,
  );

  return { service, privateInfoRepository };
}

// docs/adr/0013-account-erasure.md Decision 2's blocking security-reviewer
// finding: this method must be a raw, direct read of
// `pendingParentContact IS NOT NULL` and must NEVER go through
// getEffective() (which lazily applies a due pending change as a side
// effect of being read) — the re-confirmation pass specifically
// recommended a unit test asserting this method never applies a due
// pending change.
describe('PlayerPrivateInfoService.hasPendingContactChange', () => {
  it('returns true when a pending contact change is queued (not yet due)', async () => {
    const { service } = buildService({
      privateInfoRepository: {
        findOne: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
          contactChangeApplyAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    await expect(service.hasPendingContactChange('player-1')).resolves.toBe(
      true,
    );
  });

  it('returns true, and does NOT apply the change, when the pending change is already due (elapsed contactChangeApplyAt)', async () => {
    const row = {
      playerId: 'player-1',
      parentContact: 'old-encrypted-blob',
      pendingParentContact: 'new-encrypted-blob',
      contactChangeApplyAt: new Date(Date.now() - 60_000), // already due
      contactChangeCancelCode: 'CANCEL01',
    };
    const findOne = jest.fn().mockResolvedValue(row);
    const { service, privateInfoRepository } = buildService({
      privateInfoRepository: { findOne },
    });

    await expect(service.hasPendingContactChange('player-1')).resolves.toBe(
      true,
    );

    // The row itself must be untouched: no update call at all, and every
    // pending field is exactly as it was before the read — this is the
    // precise side effect getEffective()'s lazy-apply would otherwise
    // trigger, which this method must never reach.
    expect(privateInfoRepository.update).not.toHaveBeenCalled();
    expect(row.pendingParentContact).toBe('new-encrypted-blob');
    expect(row.contactChangeApplyAt).not.toBeNull();
    expect(row.contactChangeCancelCode).toBe('CANCEL01');
    // Only a single, unlocked findOne — never a second (locked) read the
    // way getEffective()'s apply path would issue inside its own
    // transaction.
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('returns false when no contact change is pending', async () => {
    const { service } = buildService({
      privateInfoRepository: {
        findOne: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: null,
          contactChangeApplyAt: null,
        }),
      },
    });

    await expect(service.hasPendingContactChange('player-1')).resolves.toBe(
      false,
    );
  });

  it('returns false when the player has no PlayerPrivateInfo row at all (defensive — unreachable for a real onboarded player)', async () => {
    const { service } = buildService({
      privateInfoRepository: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.hasPendingContactChange('player-1')).resolves.toBe(
      false,
    );
  });
});
