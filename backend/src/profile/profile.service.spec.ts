import { ProfileService } from './profile.service';

function buildService(overrides: {
  playersService?: Record<string, jest.Mock>;
  playerPrivateInfoService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
  mailService?: Record<string, jest.Mock>;
  configService?: Record<string, jest.Mock>;
}) {
  const playersService = {
    findByIdOrThrow: jest.fn().mockResolvedValue({
      id: 'player-1',
      birthYear: 2013,
      screenName: 'FloorballStar15',
      tokenVersion: 1,
      avatarId: 'fox',
    }),
    findByIdForUpdate: jest.fn().mockResolvedValue({
      id: 'player-1',
      birthYear: 2013,
      screenName: 'FloorballStar15',
      tokenVersion: 1,
      avatarId: 'fox',
    }),
    bumpTokenVersion: jest.fn().mockResolvedValue(undefined),
    updateAvatarId: jest.fn().mockResolvedValue(undefined),
    ...overrides.playersService,
  };
  const playerPrivateInfoService = {
    getRealName: jest.fn().mockResolvedValue(null),
    getParentContact: jest.fn().mockResolvedValue('old-parent@example.com'),
    updateRealName: jest.fn().mockResolvedValue(undefined),
    setPendingContactChange: jest.fn().mockResolvedValue(undefined),
    findValidByContactChangeCode: jest.fn(),
    startContactChangeGracePeriod: jest.fn().mockResolvedValue(undefined),
    previewByCancelCode: jest.fn(),
    findValidByCancelCode: jest.fn(),
    findByPlayerIdForUpdate: jest.fn(),
    cancelPendingContactChange: jest.fn().mockResolvedValue(undefined),
    ...overrides.playerPrivateInfoService,
  };
  const redisService = {
    tryClaimContactChangeCooldown: jest.fn().mockResolvedValue(true),
    tryClaimContactChangeDailyCap: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };
  const mailService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
    ...overrides.mailService,
  };
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
    ...overrides.configService,
  };
  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(undefined)),
  };

  const service = new ProfileService(
    dataSource as never,
    playersService as never,
    playerPrivateInfoService as never,
    redisService as never,
    mailService as never,
    configService as never,
  );

  return {
    service,
    playersService,
    playerPrivateInfoService,
    redisService,
    mailService,
    configService,
  };
}

describe('ProfileService.getProfile', () => {
  it('combines birthYear/avatarId (Player) with realName/parentContact (PlayerPrivateInfo)', async () => {
    const { service } = buildService({
      playerPrivateInfoService: {
        getRealName: jest.fn().mockResolvedValue('Åsa Öberg'),
        getParentContact: jest.fn().mockResolvedValue('parent@example.com'),
      },
    });

    await expect(service.getProfile('player-1')).resolves.toEqual({
      realName: 'Åsa Öberg',
      birthYear: 2013,
      parentContact: 'parent@example.com',
      avatarId: 'fox',
    });
  });
});

describe('ProfileService.updateRealName', () => {
  it('delegates directly to PlayerPrivateInfoService', async () => {
    const { service, playerPrivateInfoService } = buildService({});
    await service.updateRealName('player-1', 'New Name');
    expect(playerPrivateInfoService.updateRealName).toHaveBeenCalledWith(
      'player-1',
      'New Name',
    );
  });
});

describe('ProfileService.updateAvatarId', () => {
  it('delegates directly to PlayersService', async () => {
    const { service, playersService } = buildService({});
    await service.updateAvatarId('player-1', 'wolf');
    expect(playersService.updateAvatarId).toHaveBeenCalledWith(
      'player-1',
      'wolf',
    );
  });
});

describe('ProfileService.requestContactChange', () => {
  it('stores the pending change and emails both the new and old addresses', async () => {
    const { service, playerPrivateInfoService, mailService } = buildService({});

    const result = await service.requestContactChange(
      'player-1',
      'new-parent@example.com',
    );

    expect(result).toEqual({
      requested: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      expiresAt: expect.any(String),
    });
    expect(
      playerPrivateInfoService.setPendingContactChange,
    ).toHaveBeenCalledWith(
      undefined,
      'player-1',
      expect.objectContaining({ pendingContact: 'new-parent@example.com' }),
    );
    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(mailService.sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: 'new-parent@example.com' }),
    );
    expect(mailService.sendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: 'old-parent@example.com' }),
    );
  });

  // code-critic finding, 2026-08-08. Without this refusal, the second
  // (unconfirmed) address inherits the FIRST change's grace deadline, and
  // getEffective's lazy apply promotes it into parent_contact when that
  // deadline elapses — an address nobody ever confirmed, while the veto
  // email the parent received named a different one entirely.
  it('refuses a second request while a confirmed change is still inside its grace period', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-b',
          contactChangeApplyAt: new Date(Date.now() + 60_000),
          contactChangeCancelCode: 'CANCEL01',
        }),
      },
    });

    await expect(
      service.requestContactChange('player-1', 'c@example.com'),
    ).rejects.toMatchObject({ code: 'contact_change_already_confirmed' });

    expect(
      playerPrivateInfoService.setPendingContactChange,
    ).not.toHaveBeenCalled();
  });

  it('allows a second request when the first was never confirmed (no grace period started)', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-b',
          contactChangeApplyAt: null,
        }),
      },
    });

    await expect(
      service.requestContactChange('player-1', 'c@example.com'),
    ).resolves.toMatchObject({ requested: true });
    expect(playerPrivateInfoService.setPendingContactChange).toHaveBeenCalled();
  });

  it('never includes the code in its response', async () => {
    const { service } = buildService({});
    const result = await service.requestContactChange(
      'player-1',
      'new@example.com',
    );
    expect(JSON.stringify(result)).not.toMatch(/[0-9A-Z]{8}/);
  });

  it('skips the old-address email when there is no contact on file', async () => {
    const { service, mailService } = buildService({
      playerPrivateInfoService: {
        getRealName: jest.fn().mockResolvedValue(null),
        getParentContact: jest.fn().mockResolvedValue(null),
        setPendingContactChange: jest.fn().mockResolvedValue(undefined),
      },
    });

    await service.requestContactChange('player-1', 'new@example.com');

    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.com' }),
    );
  });

  it('throws ContactChangeRateLimitedException on a burst-cooldown failure, before touching the DB', async () => {
    const { service, playerPrivateInfoService, redisService, mailService } =
      buildService({
        redisService: {
          tryClaimContactChangeCooldown: jest.fn().mockResolvedValue(false),
        },
      });

    await expect(
      service.requestContactChange('player-1', 'new@example.com'),
    ).rejects.toMatchObject({ code: 'contact_change_rate_limited' });

    expect(redisService.tryClaimContactChangeDailyCap).not.toHaveBeenCalled();
    expect(
      playerPrivateInfoService.setPendingContactChange,
    ).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('throws ContactChangeRateLimitedException once the daily cap is exhausted, even with the burst cooldown clear', async () => {
    const { service, playerPrivateInfoService } = buildService({
      redisService: {
        tryClaimContactChangeDailyCap: jest.fn().mockResolvedValue(false),
      },
    });

    await expect(
      service.requestContactChange('player-1', 'new@example.com'),
    ).rejects.toMatchObject({ code: 'contact_change_rate_limited' });

    expect(
      playerPrivateInfoService.setPendingContactChange,
    ).not.toHaveBeenCalled();
  });

  it('a mail-send failure does not fail the request — the pending change already committed', async () => {
    const { service } = buildService({
      mailService: {
        sendMail: jest.fn().mockRejectedValue(new Error('smtp down')),
      },
    });

    await expect(
      service.requestContactChange('player-1', 'new@example.com'),
    ).resolves.toEqual({
      requested: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      expiresAt: expect.any(String),
    });
  });
});

// security-reviewer finding, 2026-07-28 (ADR-0012 addendum): confirm no
// longer applies the change immediately — it starts a 24h grace period and
// emails the OLD address a cancel link instead. These tests assert the new
// behavior, not the old immediate-apply one.
describe('ProfileService.confirmContactChange', () => {
  it('starts a grace period on a valid, matching code — does NOT apply immediately', async () => {
    const { service, playerPrivateInfoService, mailService } = buildService({
      playerPrivateInfoService: {
        findValidByContactChangeCode: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
        }),
      },
    });

    const result = await service.confirmContactChange('player-1', 'ABCD1234');

    expect(result).toEqual({
      confirmed: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      appliesAt: expect.any(String),
    });
    expect(
      playerPrivateInfoService.startContactChangeGracePeriod,
    ).toHaveBeenCalledWith(
      undefined,
      'player-1',
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        applyAt: expect.any(Date),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        cancelCode: expect.any(String),
      }),
    );
    // Sent to the OLD address (the cancel email), not the new one — no
    // second confirm-side email at this step.
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'old-parent@example.com' }),
    );
  });

  it('rejects with the generic error when no code matches', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findValidByContactChangeCode: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.confirmContactChange('player-1', 'BADCODE1'),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_contact_change_code' });
    expect(
      playerPrivateInfoService.startContactChangeGracePeriod,
    ).not.toHaveBeenCalled();
  });

  it('rejects a code that resolves to a DIFFERENT player, even if otherwise valid (defense in depth)', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findValidByContactChangeCode: jest.fn().mockResolvedValue({
          playerId: 'someone-elses-player-id',
          pendingParentContact: 'encrypted-blob',
        }),
      },
    });

    await expect(
      service.confirmContactChange('player-1', 'ABCD1234'),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_contact_change_code' });
    expect(
      playerPrivateInfoService.startContactChangeGracePeriod,
    ).not.toHaveBeenCalled();
  });

  it('builds the cancel link from APP_PUBLIC_URL when configured', async () => {
    const { service, mailService, configService } = buildService({
      playerPrivateInfoService: {
        findValidByContactChangeCode: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
        }),
      },
      configService: {
        get: jest.fn().mockReturnValue('https://app.skillstreak.example'),
      },
    });

    await service.confirmContactChange('player-1', 'ABCD1234');

    expect(configService.get).toHaveBeenCalledWith('APP_PUBLIC_URL');
    const [[sentMail]] = mailService.sendMail.mock.calls as [
      [{ html: string; text: string }],
    ];
    expect(sentMail.text).toContain(
      'https://app.skillstreak.example/api/v1/players/contact-change-cancel/',
    );
  });

  it('still starts the grace period even when there is no old address to notify', async () => {
    const { service, playerPrivateInfoService, mailService } = buildService({
      playerPrivateInfoService: {
        getParentContact: jest.fn().mockResolvedValue(null),
        findValidByContactChangeCode: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
        }),
      },
    });

    await expect(
      service.confirmContactChange('player-1', 'ABCD1234'),
    ).resolves.toMatchObject({ confirmed: true });
    expect(
      playerPrivateInfoService.startContactChangeGracePeriod,
    ).toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});

describe('ProfileService.previewCancelContactChange', () => {
  it('returns the screen name for a valid cancel code, no side effects', async () => {
    const { service, playerPrivateInfoService, playersService } = buildService({
      playerPrivateInfoService: {
        previewByCancelCode: jest
          .fn()
          .mockResolvedValue({ playerId: 'player-1' }),
      },
    });

    await expect(
      service.previewCancelContactChange('CANCEL01'),
    ).resolves.toEqual({ screenName: 'FloorballStar15' });
    expect(playerPrivateInfoService.previewByCancelCode).toHaveBeenCalledWith(
      'CANCEL01',
    );
    expect(playersService.findByIdForUpdate).not.toHaveBeenCalled();
  });

  it('returns null for an unknown/expired cancel code', async () => {
    const { service } = buildService({
      playerPrivateInfoService: {
        previewByCancelCode: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.previewCancelContactChange('NOPE0000'),
    ).resolves.toBeNull();
  });
});

describe('ProfileService.cancelContactChange', () => {
  it('reverts the pending change and bumps token_version, invalidating sessions', async () => {
    const { service, playerPrivateInfoService, playersService } = buildService({
      playerPrivateInfoService: {
        findValidByCancelCode: jest
          .fn()
          .mockResolvedValue({ playerId: 'player-1' }),
      },
    });

    const result = await service.cancelContactChange('CANCEL01');

    expect(result).toEqual({ screenName: 'FloorballStar15' });
    expect(
      playerPrivateInfoService.cancelPendingContactChange,
    ).toHaveBeenCalledWith(undefined, 'player-1');
    expect(playersService.bumpTokenVersion).toHaveBeenCalledWith(
      undefined,
      'player-1',
      2,
    );
  });

  it('returns null (not a thrown error) for an unknown/already-used cancel code', async () => {
    const { service, playersService } = buildService({
      playerPrivateInfoService: {
        findValidByCancelCode: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.cancelContactChange('NOPE0000')).resolves.toBeNull();
    expect(playersService.bumpTokenVersion).not.toHaveBeenCalled();
  });
});

// The authenticated self-cancel (BACKLOG.md's option (a), 2026-08-08).
// Its whole reason to exist is the unconfirmed-and-expired state, which
// the emailed old-address link above cannot reach: that link is keyed by
// a contactChangeCancelCode, and one is only ever minted at confirm time.
describe('ProfileService.cancelOwnContactChange', () => {
  it('clears a pending change the player never confirmed', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
          contactChangeCode: 'ABC123',
          contactChangeCodeExpiresAt: new Date(Date.now() - 60_000),
          contactChangeApplyAt: null,
        }),
      },
    });

    await expect(service.cancelOwnContactChange('player-1')).resolves.toEqual({
      cancelled: true,
    });
    expect(
      playerPrivateInfoService.cancelPendingContactChange,
    ).toHaveBeenCalledWith(undefined, 'player-1');
  });

  // Security review, 2026-08-08: this used to be allowed, on the argument
  // that cancelling always resolves toward the old parent contact and is
  // therefore fail-safe. True of the contact, false of the consequences —
  // it also clears contactChangeCancelCode, which is the old address
  // holder's only lever, and the ONLY path that bumps token_version and
  // evicts a hijacked session. A confirmed change is theirs to cancel now.
  it('refuses to cancel a confirmed change in its grace period, leaving the parent’s cancel code intact', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
          contactChangeApplyAt: new Date(Date.now() + 60_000),
          contactChangeCancelCode: 'CANCEL01',
        }),
      },
    });

    await expect(service.cancelOwnContactChange('player-1')).resolves.toEqual({
      cancelled: false,
    });
    expect(
      playerPrivateInfoService.cancelPendingContactChange,
    ).not.toHaveBeenCalled();
  });

  // The same refusal applies once the grace period has elapsed but the
  // lazy apply hasn't run yet — still not this route's to resolve.
  it('refuses to cancel a confirmed change that is already past due', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
          contactChangeApplyAt: new Date(Date.now() - 60_000),
          contactChangeCancelCode: 'CANCEL01',
        }),
      },
    });

    await expect(service.cancelOwnContactChange('player-1')).resolves.toEqual({
      cancelled: false,
    });
    expect(
      playerPrivateInfoService.cancelPendingContactChange,
    ).not.toHaveBeenCalled();
  });

  // Unlike the emailed link, this one must NOT log the player out — they
  // are cancelling their own typo from inside the app, not reporting a
  // hijacked session.
  it('does not bump the token version', async () => {
    const { service, playersService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: 'encrypted-blob',
          contactChangeApplyAt: null,
        }),
      },
    });

    await service.cancelOwnContactChange('player-1');

    expect(playersService.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('is idempotent — reports cancelled:false and writes nothing when there is no pending change', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue({
          playerId: 'player-1',
          pendingParentContact: null,
          contactChangeApplyAt: null,
        }),
      },
    });

    await expect(service.cancelOwnContactChange('player-1')).resolves.toEqual({
      cancelled: false,
    });
    expect(
      playerPrivateInfoService.cancelPendingContactChange,
    ).not.toHaveBeenCalled();
  });

  it('reports cancelled:false when the player has no PlayerPrivateInfo row at all (defensive)', async () => {
    const { service, playerPrivateInfoService } = buildService({
      playerPrivateInfoService: {
        findByPlayerIdForUpdate: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.cancelOwnContactChange('player-1')).resolves.toEqual({
      cancelled: false,
    });
    expect(
      playerPrivateInfoService.cancelPendingContactChange,
    ).not.toHaveBeenCalled();
  });
});
