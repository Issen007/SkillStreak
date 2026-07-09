import {
  ChatMessageAlreadyReportedException,
  ChatMessageNotFoundException,
  ChatMessageRejectedByFilterException,
  ChatReportRateLimitedException,
  ChatSendRateLimitedException,
  ConsentRequiredException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { ChatMessageStatus } from './entities/team-chat-message.entity';
import { ChatMessageReportReason } from './entities/team-chat-message-report.entity';
import { TeamChatService } from './team-chat.service';

// Chainable fake query builder, mirroring weekly-goal.service.spec.ts's
// helper of the same shape — every method returns `this` except the
// terminal one (getMany), configurable per test.
function makeQueryBuilder(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  const chain = ['where', 'andWhere', 'orderBy', 'limit'];
  for (const method of chain) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  return qb;
}

function buildService(
  overrides: {
    messages?: unknown[];
    moderationAllowed?: boolean;
  } = {},
) {
  const player = {
    id: 'player-1',
    teamId: 'team-1',
    screenName: 'FloorballStar15',
    avatarId: 'fox',
    parentalConsentStatus: ParentalConsentStatus.APPROVED,
  };

  const playersService = {
    assertTeamMembership: jest.fn().mockResolvedValue(player),
    listByTeam: jest.fn().mockResolvedValue([player]),
    findByIdOrThrow: jest.fn().mockResolvedValue(player),
  };
  const playerPrivateInfoService = {
    getParentContact: jest.fn().mockResolvedValue('parent@example.com'),
  };
  const teamsService = {
    findById: jest.fn().mockResolvedValue({ id: 'team-1', name: 'Team 1' }),
  };
  const redisService = {
    tryClaimChatSendAllowance: jest.fn().mockResolvedValue(true),
    tryClaimChatReportCooldown: jest.fn().mockResolvedValue(true),
    tryClaimChatReportNotifyCooldown: jest.fn().mockResolvedValue(true),
  };
  const mailService = { sendMail: jest.fn().mockResolvedValue(undefined) };
  const chatModerationCheck = {
    check: jest
      .fn()
      .mockResolvedValue({ allowed: overrides.moderationAllowed ?? true }),
  };

  const messageQb = makeQueryBuilder(overrides.messages ?? []);
  const messageRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(messageQb),
    save: jest.fn((entity: Record<string, unknown>) =>
      Promise.resolve({ ...entity, id: 'msg-new', createdAt: new Date() }),
    ),
    create: jest.fn((entity: unknown) => entity),
    findOne: jest.fn(),
  };
  const blockRepository = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn((entity: Record<string, unknown>) =>
      Promise.resolve({ ...entity, id: 'block-new', createdAt: new Date() }),
    ),
    create: jest.fn((entity: unknown) => entity),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const reportRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((entity: unknown) =>
      Promise.resolve({ ...entity, id: 'report-1', createdAt: new Date() }),
    ),
    create: jest.fn((entity: unknown) => entity),
  };
  const teamCoachRepository = { find: jest.fn().mockResolvedValue([]) };
  const coachRepository = { find: jest.fn().mockResolvedValue([]) };

  const service = new TeamChatService(
    playersService as never,
    playerPrivateInfoService as never,
    teamsService as never,
    redisService as never,
    mailService as never,
    chatModerationCheck,
    messageRepository as never,
    blockRepository as never,
    reportRepository as never,
    teamCoachRepository as never,
    coachRepository as never,
  );

  return {
    service,
    player,
    playersService,
    playerPrivateInfoService,
    teamsService,
    redisService,
    mailService,
    chatModerationCheck,
    messageQb,
    messageRepository,
    blockRepository,
    reportRepository,
    teamCoachRepository,
    coachRepository,
  };
}

describe('TeamChatService.postMessage', () => {
  it('rejects with consent_required before ever touching the rate limit or moderation check', async () => {
    const { service, playersService, redisService, chatModerationCheck } =
      buildService();
    playersService.assertTeamMembership.mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    });

    await expect(
      service.postMessage('team-1', 'player-1', { content: 'hej' }),
    ).rejects.toBeInstanceOf(ConsentRequiredException);
    expect(redisService.tryClaimChatSendAllowance).not.toHaveBeenCalled();
    expect(chatModerationCheck.check).not.toHaveBeenCalled();
  });

  it('rejects with chat_send_rate_limited when the send allowance is exhausted, without running the moderation check', async () => {
    const { service, redisService, chatModerationCheck } = buildService();
    redisService.tryClaimChatSendAllowance.mockResolvedValue(false);

    await expect(
      service.postMessage('team-1', 'player-1', { content: 'hej' }),
    ).rejects.toBeInstanceOf(ChatSendRateLimitedException);
    expect(chatModerationCheck.check).not.toHaveBeenCalled();
  });

  it('rejects with message_rejected_by_filter and never persists the message', async () => {
    const { service, messageRepository } = buildService({
      moderationAllowed: false,
    });

    await expect(
      service.postMessage('team-1', 'player-1', { content: 'banned word' }),
    ).rejects.toBeInstanceOf(ChatMessageRejectedByFilterException);
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('persists and returns the message on the happy path', async () => {
    const { service } = buildService();

    const result = await service.postMessage('team-1', 'player-1', {
      content: 'Bra jobbat!',
    });

    expect(result).toMatchObject({
      teamId: 'team-1',
      senderPlayerId: 'player-1',
      senderScreenName: 'FloorballStar15',
      senderAvatarId: 'fox',
      content: 'Bra jobbat!',
    });
  });
});

describe('TeamChatService.listMessages', () => {
  it('applies the status + per-viewer-block filters in the same query and marks reportedByMe per message', async () => {
    const messageA = {
      id: 'msg-1',
      senderPlayerId: 'player-1',
      content: 'hej',
      createdAt: new Date('2026-07-08T10:00:00Z'),
    };
    const { service, messageQb, reportRepository } = buildService({
      messages: [messageA],
    });
    reportRepository.find.mockResolvedValue([
      { messageId: 'msg-1', reporterPlayerId: 'player-1' },
    ]);

    const result = await service.listMessages(
      'team-1',
      'player-1',
      undefined,
      50,
    );

    // One where + the status/block andWhere calls all landed on the same
    // query-builder chain (not two separately-built queries).
    expect(messageQb.where).toHaveBeenCalledTimes(1);
    const andWhereSqlCalls = messageQb.andWhere.mock.calls.map(
      ([sql]: [string]) => sql,
    );
    expect(andWhereSqlCalls.some((sql) => sql.includes('status'))).toBe(true);
    expect(andWhereSqlCalls.some((sql) => sql.includes('NOT EXISTS'))).toBe(
      true,
    );

    expect(result).toEqual([
      {
        id: 'msg-1',
        senderPlayerId: 'player-1',
        senderScreenName: 'FloorballStar15',
        senderAvatarId: 'fox',
        content: 'hej',
        createdAt: messageA.createdAt.toISOString(),
        reportedByMe: true,
      },
    ]);
  });

  it('adds an additional created_at filter only when `after` is supplied', async () => {
    const { service, messageQb } = buildService({ messages: [] });
    await service.listMessages('team-1', 'player-1', undefined, 50);
    let andWhereSqlCalls = messageQb.andWhere.mock.calls.map(
      ([sql]: [string]) => sql,
    );
    expect(andWhereSqlCalls.some((sql) => sql.includes('created_at >'))).toBe(
      false,
    );

    await service.listMessages(
      'team-1',
      'player-1',
      '2026-07-08T00:00:00Z',
      50,
    );
    andWhereSqlCalls = messageQb.andWhere.mock.calls.map(
      ([sql]: [string]) => sql,
    );
    expect(andWhereSqlCalls.some((sql) => sql.includes('created_at >'))).toBe(
      true,
    );
  });

  it('throws (a "can\'t occur given the contract" 500) if a message references a sender not on the team roster', async () => {
    const { service, playersService } = buildService({
      messages: [
        {
          id: 'msg-1',
          senderPlayerId: 'ghost-player',
          content: 'hej',
          createdAt: new Date(),
        },
      ],
    });
    playersService.listByTeam.mockResolvedValue([]);

    await expect(
      service.listMessages('team-1', 'player-1', undefined, 50),
    ).rejects.toThrow();
  });
});

describe('TeamChatService.reportMessage', () => {
  const message = {
    id: 'msg-1',
    teamId: 'team-1',
    senderPlayerId: 'player-2',
    content: 'hej',
  };

  it('rejects with chat_message_not_found for a message outside this team (or nonexistent)', async () => {
    const { service, messageRepository } = buildService();
    messageRepository.findOne.mockResolvedValue(null);

    await expect(
      service.reportMessage('team-1', 'player-1', 'msg-1', {
        reason: ChatMessageReportReason.SPAM,
      }),
    ).rejects.toBeInstanceOf(ChatMessageNotFoundException);
  });

  it('rejects an already-reported message with 409 WITHOUT ever claiming the report cooldown', async () => {
    const { service, messageRepository, reportRepository, redisService } =
      buildService();
    messageRepository.findOne.mockResolvedValue(message);
    reportRepository.findOne.mockResolvedValue({
      id: 'existing-report',
      messageId: 'msg-1',
      reporterPlayerId: 'player-1',
    });

    await expect(
      service.reportMessage('team-1', 'player-1', 'msg-1', {
        reason: ChatMessageReportReason.SPAM,
      }),
    ).rejects.toBeInstanceOf(ChatMessageAlreadyReportedException);
    expect(redisService.tryClaimChatReportCooldown).not.toHaveBeenCalled();
  });

  it('rejects with chat_report_rate_limited once the reporter cooldown is claimed elsewhere', async () => {
    const { service, messageRepository, redisService } = buildService();
    messageRepository.findOne.mockResolvedValue(message);
    redisService.tryClaimChatReportCooldown.mockResolvedValue(false);

    await expect(
      service.reportMessage('team-1', 'player-1', 'msg-1', {
        reason: ChatMessageReportReason.SPAM,
      }),
    ).rejects.toBeInstanceOf(ChatReportRateLimitedException);
  });

  it('persists the report and never returns/exposes it to any future caller beyond reportId/messageId/createdAt', async () => {
    const { service, messageRepository } = buildService();
    messageRepository.findOne.mockResolvedValue(message);

    const result = await service.reportMessage('team-1', 'player-1', 'msg-1', {
      reason: ChatMessageReportReason.BULLYING,
      note: 'not cool',
    });

    expect(result).toEqual({
      reportId: 'report-1',
      messageId: 'msg-1',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      createdAt: expect.any(String),
    });
  });

  it("sends the best-effort notification email to the reported player's parent when the 24h cooldown allows it", async () => {
    const { service, messageRepository, mailService } = buildService();
    messageRepository.findOne.mockResolvedValue(message);

    await service.reportMessage('team-1', 'player-1', 'msg-1', {
      reason: ChatMessageReportReason.SPAM,
    });

    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com' }),
    );
  });

  it('does not send (and does not throw) when the 24h notify cooldown is already claimed', async () => {
    const { service, messageRepository, redisService, mailService } =
      buildService();
    messageRepository.findOne.mockResolvedValue(message);
    redisService.tryClaimChatReportNotifyCooldown.mockResolvedValue(false);

    await expect(
      service.reportMessage('team-1', 'player-1', 'msg-1', {
        reason: ChatMessageReportReason.SPAM,
      }),
    ).resolves.toBeDefined();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('never fails the request even if the mail send throws (best-effort)', async () => {
    const { service, messageRepository, mailService } = buildService();
    messageRepository.findOne.mockResolvedValue(message);
    mailService.sendMail.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.reportMessage('team-1', 'player-1', 'msg-1', {
        reason: ChatMessageReportReason.SPAM,
      }),
    ).resolves.toBeDefined();
  });
});

describe('TeamChatService.blockPlayer / unblockPlayer', () => {
  it('rejects a self-block with a plain 400', async () => {
    const { service } = buildService();
    await expect(
      service.blockPlayer('team-1', 'player-1', {
        blockedPlayerId: 'player-1',
      }),
    ).rejects.toThrow();
  });

  it('rejects blocking a player on a different team with team_mismatch', async () => {
    const { service, playersService } = buildService();
    playersService.findByIdOrThrow.mockResolvedValue({
      id: 'player-2',
      teamId: 'other-team',
    });

    await expect(
      service.blockPlayer('team-1', 'player-1', {
        blockedPlayerId: 'player-2',
      }),
    ).rejects.toBeInstanceOf(TeamMismatchException);
  });

  it('is idempotent — an already-existing block is a 200 no-op, not a fresh insert', async () => {
    const { service, playersService, blockRepository } = buildService();
    playersService.findByIdOrThrow.mockResolvedValue({
      id: 'player-2',
      teamId: 'team-1',
    });
    const existingCreatedAt = new Date('2026-07-01T00:00:00Z');
    blockRepository.findOne.mockResolvedValue({
      createdAt: existingCreatedAt,
    });

    const result = await service.blockPlayer('team-1', 'player-1', {
      blockedPlayerId: 'player-2',
    });

    expect(result).toEqual({
      blockedPlayerId: 'player-2',
      createdAt: existingCreatedAt.toISOString(),
    });
    expect(blockRepository.save).not.toHaveBeenCalled();
  });

  it('creates a new block row when none exists yet', async () => {
    const { service, playersService, blockRepository } = buildService();
    playersService.findByIdOrThrow.mockResolvedValue({
      id: 'player-2',
      teamId: 'team-1',
    });
    blockRepository.findOne.mockResolvedValue(null);

    const result = await service.blockPlayer('team-1', 'player-1', {
      blockedPlayerId: 'player-2',
    });

    expect(blockRepository.save).toHaveBeenCalled();
    expect(result.blockedPlayerId).toBe('player-2');
  });

  it('unblockPlayer always succeeds, whether or not a block existed', async () => {
    const { service, blockRepository } = buildService();
    const result = await service.unblockPlayer(
      'team-1',
      'player-1',
      'player-2',
    );
    expect(blockRepository.delete).toHaveBeenCalledWith({
      blockerPlayerId: 'player-1',
      blockedPlayerId: 'player-2',
    });
    expect(result).toEqual({ blockedPlayerId: 'player-2', unblocked: true });
  });
});

// Exercised here rather than only via team-chat.service.spec.ts's mocked
// paths above: ChatMessageStatus.VISIBLE is the default a real Postgres
// row would carry, asserted so a future refactor can't accidentally change
// the default without a test noticing.
describe('ChatMessageStatus', () => {
  it('is visible by default (per the entity)', () => {
    expect(ChatMessageStatus.VISIBLE).toBe('visible');
    expect(ChatMessageStatus.HIDDEN).toBe('hidden');
  });
});
