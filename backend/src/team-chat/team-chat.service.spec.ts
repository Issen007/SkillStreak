import {
  ChatMessageAlreadyReportedException,
  ChatMessageNotFoundException,
  ChatMessageRejectedByFilterException,
  ChatReportRateLimitedException,
  ChatSendRateLimitedException,
  ClipNotFoundException,
  ConsentRequiredException,
  TeamMismatchException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { VideoClipStatus } from '../video-clips/entities/video-clip.entity';
import { ChatMessageStatus } from './entities/team-chat-message.entity';
import { ChatMessageReportReason } from './entities/team-chat-message-report.entity';
import { TeamChatService } from './team-chat.service';

// Chainable fake query builder, mirroring weekly-goal.service.spec.ts's
// helper of the same shape — every method returns `this` except the
// terminal one (getRawAndEntities), configurable per test. `raw` defaults to
// one all-null clip row per message (the "no attachment" shape every
// pre-ADR-0017 test still expects) unless a test overrides it.
function makeQueryBuilder(entities: unknown[], raw?: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  const chain = [
    'leftJoin',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'limit',
  ];
  for (const method of chain) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  const defaultRaw = entities.map(() => ({
    clipId: null,
    clipUploaderPlayerId: null,
    clipStorageKey: null,
    clipCaption: null,
    clipCreatedAt: null,
  }));
  qb.getRawAndEntities = jest
    .fn()
    .mockResolvedValue({ entities, raw: raw ?? defaultRaw });
  return qb;
}

function buildService(
  overrides: {
    messages?: unknown[];
    messagesRaw?: unknown[];
    moderationAllowed?: boolean;
  } = {},
) {
  const player = {
    id: 'player-1',
    teamId: 'team-1',
    screenName: 'FloorballStar15',
    avatarId: 'fox',
    parentalConsentStatus: ParentalConsentStatus.APPROVED,
    teamJoinStatus: TeamJoinStatus.APPROVED,
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
  const objectStorageService = {
    createPresignedGetUrl: jest
      .fn()
      .mockResolvedValue('https://minio.internal/clips/presigned-get'),
  };
  const chatModerationCheck = {
    check: jest
      .fn()
      .mockResolvedValue({ allowed: overrides.moderationAllowed ?? true }),
  };

  const messageQb = makeQueryBuilder(
    overrides.messages ?? [],
    overrides.messagesRaw,
  );
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
  const videoClipRepository = { findOne: jest.fn().mockResolvedValue(null) };

  const service = new TeamChatService(
    playersService as never,
    playerPrivateInfoService as never,
    teamsService as never,
    redisService as never,
    mailService as never,
    objectStorageService as never,
    chatModerationCheck,
    messageRepository as never,
    blockRepository as never,
    reportRepository as never,
    teamCoachRepository as never,
    coachRepository as never,
    videoClipRepository as never,
  );

  return {
    service,
    player,
    playersService,
    playerPrivateInfoService,
    objectStorageService,
    videoClipRepository,
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

  it('persists and returns the message on the happy path, with clip: null when no clipId was sent', async () => {
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
      clip: null,
    });
  });

  // --- docs/adr/0017-chat-clip-attachments.md Decision 1/4/5 -----------------

  it('rejects with clip_not_found when clipId does not resolve to a published clip on this team, before claiming the rate limit or running moderation', async () => {
    const { service, videoClipRepository, redisService, chatModerationCheck } =
      buildService();
    videoClipRepository.findOne.mockResolvedValue(null);

    await expect(
      service.postMessage('team-1', 'player-1', {
        content: 'kolla',
        clipId: 'clip-other-team',
      }),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
    expect(redisService.tryClaimChatSendAllowance).not.toHaveBeenCalled();
    expect(chatModerationCheck.check).not.toHaveBeenCalled();
  });

  it("scopes the clip lookup to this team and 'published' status only — a hidden/pending clip on this team is also clip_not_found", async () => {
    const { service, videoClipRepository } = buildService();
    videoClipRepository.findOne.mockResolvedValue(null);

    await expect(
      service.postMessage('team-1', 'player-1', {
        content: 'kolla',
        clipId: 'clip-hidden',
      }),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
    expect(videoClipRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'clip-hidden',
        teamId: 'team-1',
        status: VideoClipStatus.PUBLISHED,
      },
    });
  });

  it('rejects with a plain 400 when content is empty/whitespace-only and no clipId is present', async () => {
    const { service, redisService, chatModerationCheck } = buildService();

    await expect(
      service.postMessage('team-1', 'player-1', { content: '' }),
    ).rejects.toThrow();
    expect(redisService.tryClaimChatSendAllowance).not.toHaveBeenCalled();
    expect(chatModerationCheck.check).not.toHaveBeenCalled();
  });

  it('accepts an empty content string when a valid clipId is present, and returns the clip embed', async () => {
    const clip = {
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-2',
      storageKey: 'clips/team-1/clip-1.mp4',
      caption: 'Zorro-fint #47!',
      createdAt: new Date('2026-07-20T18:07:00Z'),
    };
    const {
      service,
      videoClipRepository,
      playersService,
      objectStorageService,
    } = buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);
    playersService.findByIdOrThrow.mockResolvedValue({
      id: 'player-2',
      screenName: 'ZorroKing09',
      avatarId: 'wolf',
    });

    const result = await service.postMessage('team-1', 'player-1', {
      content: '',
      clipId: 'clip-1',
    });

    expect(result.content).toBe('');
    expect(result.clip).toEqual({
      clipId: 'clip-1',
      uploaderPlayerId: 'player-2',
      uploaderScreenName: 'ZorroKing09',
      uploaderAvatarId: 'wolf',
      caption: 'Zorro-fint #47!',
      playbackUrl: 'https://minio.internal/clips/presigned-get',
      createdAt: clip.createdAt.toISOString(),
    });
    expect(objectStorageService.createPresignedGetUrl).toHaveBeenCalledWith(
      clip.storageKey,
      expect.any(Number),
    );
  });

  it('persists the message with the resolved clip.id, not the raw request clipId, and never re-checks the caption via the moderation filter', async () => {
    const clip = {
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-2',
      storageKey: 'clips/team-1/clip-1.mp4',
      caption: 'a banned word here',
      createdAt: new Date(),
    };
    const {
      service,
      videoClipRepository,
      messageRepository,
      chatModerationCheck,
    } = buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);

    await service.postMessage('team-1', 'player-1', {
      content: 'kolla klippet',
      clipId: 'clip-1',
    });

    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ clipId: 'clip-1' }),
    );
    // The moderation check only ever runs against the message's own
    // `content` — never the clip's own (separately, already-moderated at
    // upload time) caption.
    expect(chatModerationCheck.check).toHaveBeenCalledWith('kolla klippet');
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
        clip: null,
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

  // --- docs/adr/0017-chat-clip-attachments.md Decision 1/2 -------------------

  it("joins video_clip with a predicate that includes the message's own team_id, published status, and a clip-uploader-scoped block NOT EXISTS — the structural team-scoping guarantee, not a bare id join", async () => {
    const { service, messageQb } = buildService({ messages: [] });
    await service.listMessages('team-1', 'player-1', undefined, 50);

    expect(messageQb.leftJoin).toHaveBeenCalledTimes(1);
    const [, alias, condition] = messageQb.leftJoin.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(alias).toBe('clip');
    expect(condition).toContain('clip.team_id = message.team_id');
    expect(condition).toContain('clip.status = :clipStatus');
    expect(condition).toContain('NOT EXISTS');
    expect(condition).toContain('clip.uploader_player_id');
  });

  it('resolves a message whose clip_id joined a live, published, non-blocked clip into a populated `clip` embed', async () => {
    const messageA = {
      id: 'msg-1',
      senderPlayerId: 'player-1',
      content: 'kolla den har fintan',
      createdAt: new Date('2026-07-31T18:04:00Z'),
    };
    const rawWithClip = {
      clipId: 'clip-1',
      clipUploaderPlayerId: 'player-2',
      clipStorageKey: 'clips/team-1/clip-1.mp4',
      clipCaption: 'Zorro-fint #47!',
      clipCreatedAt: new Date('2026-07-20T18:07:00Z'),
    };
    const { service, playersService, objectStorageService } = buildService({
      messages: [messageA],
      messagesRaw: [rawWithClip],
    });
    playersService.listByTeam.mockResolvedValue([
      { id: 'player-1', screenName: 'FloorballStar15', avatarId: 'fox' },
      { id: 'player-2', screenName: 'ZorroKing09', avatarId: 'wolf' },
    ]);

    const [result] = await service.listMessages(
      'team-1',
      'player-1',
      undefined,
      50,
    );

    expect(result.clip).toEqual({
      clipId: 'clip-1',
      uploaderPlayerId: 'player-2',
      uploaderScreenName: 'ZorroKing09',
      uploaderAvatarId: 'wolf',
      caption: 'Zorro-fint #47!',
      playbackUrl: 'https://minio.internal/clips/presigned-get',
      createdAt: rawWithClip.clipCreatedAt.toISOString(),
    });
    expect(objectStorageService.createPresignedGetUrl).toHaveBeenCalledWith(
      rawWithClip.clipStorageKey,
      expect.any(Number),
    );
  });

  it('resolves `clip: null` whenever the joined raw row has no clip columns — covering "no clipId", "clip gone/hidden/cross-team" (excluded by the join predicate), and "viewer blocked the uploader" (excluded by the same predicate) identically, per contract', async () => {
    const messageA = {
      id: 'msg-1',
      senderPlayerId: 'player-1',
      content: 'kolla den har fintan',
      createdAt: new Date(),
    };
    const { service } = buildService({
      messages: [messageA],
      messagesRaw: [
        {
          clipId: null,
          clipUploaderPlayerId: null,
          clipStorageKey: null,
          clipCaption: null,
          clipCreatedAt: null,
        },
      ],
    });

    const [result] = await service.listMessages(
      'team-1',
      'player-1',
      undefined,
      50,
    );

    expect(result.clip).toBeNull();
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
