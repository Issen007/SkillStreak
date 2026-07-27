import { CaptainConsentRequiredException } from '../common/errors/exceptions';
import { SessionService } from './session.service';

function buildService(overrides: {
  playersService?: Record<string, jest.Mock>;
  redisService?: Record<string, jest.Mock>;
  playerPrivateInfoService?: Record<string, jest.Mock>;
  teamsService?: Record<string, jest.Mock>;
  mailService?: Record<string, jest.Mock>;
}) {
  const playersService = {
    findByIdOrThrow: jest.fn(),
    assertIsCaptainOfTeam: jest.fn().mockResolvedValue(undefined),
    findByIdForUpdate: jest.fn(),
    setSessionReissueCode: jest.fn(),
    findUniqueByTeamAndScreenName: jest.fn(),
    ...overrides.playersService,
  };
  const redisService = {
    tryClaimSessionReissueCooldown: jest.fn().mockResolvedValue(true),
    tryClaimSessionReissueDailyCap: jest.fn().mockResolvedValue(true),
    ...overrides.redisService,
  };
  const playerPrivateInfoService = {
    getParentContact: jest.fn().mockResolvedValue('parent@example.com'),
    ...overrides.playerPrivateInfoService,
  };
  const teamsService = {
    findByInviteCode: jest.fn(),
    findById: jest.fn().mockResolvedValue({ name: 'Test Team' }),
    ...overrides.teamsService,
  };
  const mailService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
    ...overrides.mailService,
  };
  const dataSource = {
    transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(undefined)),
  };

  const service = new SessionService(
    dataSource as never,
    playersService as never,
    undefined as never,
    playerPrivateInfoService as never,
    teamsService as never,
    redisService as never,
    mailService as never,
  );

  return {
    service,
    playersService,
    redisService,
    playerPrivateInfoService,
    teamsService,
    mailService,
  };
}

// SessionController's routes were both unconditionally disabled (503) from
// 2026-07-05 until docs/adr/0004-coach-auth-and-session-reissue.md's
// 2026-07-27 redesign — see that ADR addendum for the confirmed critical
// bug this closes (the code was redeemable by whoever triggered it).
describe("SessionService.triggerReissue — acting-captain's own consent gate", () => {
  it('propagates CaptainConsentRequiredException from assertIsCaptainOfTeam without ever generating a reissue code', async () => {
    const targetPlayer = { id: 'target-1', teamId: 'team-1' };
    const { service, playersService, redisService } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue(targetPlayer),
        assertIsCaptainOfTeam: jest
          .fn()
          .mockRejectedValue(new CaptainConsentRequiredException()),
      },
    });

    await expect(
      service.triggerReissue('captain-1', 'target-1'),
    ).rejects.toBeInstanceOf(CaptainConsentRequiredException);

    expect(playersService.assertIsCaptainOfTeam).toHaveBeenCalledWith(
      'captain-1',
      'team-1',
    );
    expect(playersService.findByIdForUpdate).not.toHaveBeenCalled();
    expect(playersService.setSessionReissueCode).not.toHaveBeenCalled();
    expect(redisService.tryClaimSessionReissueCooldown).not.toHaveBeenCalled();
  });
});

describe('SessionService.triggerReissue — the 2026-07-27 redesign', () => {
  it('never includes the code in its response, and emails it to parent_contact instead', async () => {
    const targetPlayer = {
      id: 'target-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      tokenVersion: 0,
    };
    const { service, mailService } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue(targetPlayer),
        findByIdForUpdate: jest.fn().mockResolvedValue(targetPlayer),
      },
    });

    const result = await service.triggerReissue('captain-1', 'target-1');

    expect(result).toEqual({
      requested: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      expiresAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toMatch(/[0-9A-Z]{8}/); // no code-shaped value
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com' }),
    );
  });

  it('throws SessionReissueRateLimitedException on a cooldown claim failure, before generating a code', async () => {
    const targetPlayer = { id: 'target-1', teamId: 'team-1' };
    const { service, playersService, mailService, redisService } = buildService(
      {
        playersService: {
          findByIdOrThrow: jest.fn().mockResolvedValue(targetPlayer),
        },
        redisService: {
          tryClaimSessionReissueCooldown: jest.fn().mockResolvedValue(false),
        },
      },
    );

    await expect(
      service.triggerReissue('captain-1', 'target-1'),
    ).rejects.toMatchObject({ code: 'session_reissue_rate_limited' });

    // A burst-blocked attempt never even checks the daily cap — the
    // sequencing fix (security-reviewer, 2026-07-27) that keeps a blocked
    // attempt from consuming the daily budget.
    expect(redisService.tryClaimSessionReissueDailyCap).not.toHaveBeenCalled();
    expect(playersService.findByIdForUpdate).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('throws SessionReissueRateLimitedException once the daily cap is exhausted, even with the burst cooldown clear', async () => {
    const targetPlayer = { id: 'target-1', teamId: 'team-1' };
    const { service, playersService, mailService } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue(targetPlayer),
      },
      redisService: {
        tryClaimSessionReissueDailyCap: jest.fn().mockResolvedValue(false),
      },
    });

    await expect(
      service.triggerReissue('captain-1', 'target-1'),
    ).rejects.toMatchObject({ code: 'session_reissue_rate_limited' });

    expect(playersService.findByIdForUpdate).not.toHaveBeenCalled();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('a mail-send failure does not fail the request — the reissue already committed', async () => {
    const targetPlayer = {
      id: 'target-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      tokenVersion: 0,
    };
    const { service } = buildService({
      playersService: {
        findByIdOrThrow: jest.fn().mockResolvedValue(targetPlayer),
        findByIdForUpdate: jest.fn().mockResolvedValue(targetPlayer),
      },
      mailService: {
        sendMail: jest.fn().mockRejectedValue(new Error('smtp down')),
      },
    });

    await expect(
      service.triggerReissue('captain-1', 'target-1'),
    ).resolves.toEqual({
      requested: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      expiresAt: expect.any(String),
    });
  });
});

describe('SessionService.requestReissueSelfService — the confirmed real "I already have an account" gap', () => {
  it('returns the same generic response whether or not a match was found, and never throws', async () => {
    const { service, teamsService } = buildService({
      teamsService: { findByInviteCode: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.requestReissueSelfService('NOSUCHCODE', 'AnyName'),
    ).resolves.toEqual({ requested: true });
    expect(teamsService.findByInviteCode).toHaveBeenCalledWith('NOSUCHCODE');
  });

  it('swallows a cooldown-limited match into the same generic response (no distinguishable failure)', async () => {
    const targetPlayer = {
      id: 'target-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      tokenVersion: 0,
    };
    const { service, mailService } = buildService({
      teamsService: {
        findByInviteCode: jest.fn().mockResolvedValue({ id: 'team-1' }),
      },
      playersService: {
        findUniqueByTeamAndScreenName: jest
          .fn()
          .mockResolvedValue(targetPlayer),
      },
      redisService: {
        tryClaimSessionReissueCooldown: jest.fn().mockResolvedValue(false),
      },
    });

    await expect(
      service.requestReissueSelfService('TEAMCODE', 'FloorballStar15'),
    ).resolves.toEqual({ requested: true });
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('a genuine match triggers the same underlying reissue mechanism', async () => {
    const targetPlayer = {
      id: 'target-1',
      teamId: 'team-1',
      screenName: 'FloorballStar15',
      tokenVersion: 0,
    };
    const { service, playersService, mailService } = buildService({
      teamsService: {
        findByInviteCode: jest.fn().mockResolvedValue({ id: 'team-1' }),
      },
      playersService: {
        findUniqueByTeamAndScreenName: jest
          .fn()
          .mockResolvedValue(targetPlayer),
        findByIdForUpdate: jest.fn().mockResolvedValue(targetPlayer),
      },
    });

    await expect(
      service.requestReissueSelfService('TEAMCODE', 'FloorballStar15'),
    ).resolves.toEqual({ requested: true });
    expect(playersService.setSessionReissueCode).toHaveBeenCalled();
    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
  });
});
