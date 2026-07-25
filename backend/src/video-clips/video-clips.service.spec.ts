import {
  ClipAlreadyReportedException,
  ClipNotFoundException,
  ClipProcessingFailedException,
  ClipReportRateLimitedException,
  ClipUploadRateLimitedException,
  CaptionRejectedByFilterException,
  ConsentRequiredException,
  NotYourClipException,
  UploadNotFoundException,
} from '../common/errors/exceptions';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { VideoClipStatus } from './entities/video-clip.entity';
import { VideoClipsService } from './video-clips.service';

// Chainable fake query builder, mirroring team-chat.service.spec.ts's
// helper of the same shape (itself mirroring weekly-goal.service.spec.ts).
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
    clips?: unknown[];
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
    tryClaimClipUploadAllowance: jest.fn().mockResolvedValue(true),
    tryClaimClipReportCooldown: jest.fn().mockResolvedValue(true),
    tryClaimClipReportNotifyCooldown: jest.fn().mockResolvedValue(true),
  };
  const mailService = { sendMail: jest.fn().mockResolvedValue(undefined) };
  const objectStorageService = {
    createPresignedPutUrl: jest.fn().mockResolvedValue('https://minio/put-url'),
    createPresignedGetUrl: jest.fn().mockResolvedValue('https://minio/get-url'),
    headObject: jest
      .fn()
      .mockResolvedValue({ sizeBytes: 1000, contentType: 'video/mp4' }),
    getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('bytes')),
    putObjectBuffer: jest.fn().mockResolvedValue(undefined),
    deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
  };
  const videoProcessingService = {
    writeTempFile: jest.fn().mockResolvedValue('/tmp/in.mp4'),
    readTempFile: jest.fn().mockResolvedValue(Buffer.from('stripped')),
    deleteTempFileIfExists: jest.fn().mockResolvedValue(undefined),
    probe: jest
      .fn()
      .mockResolvedValue({ durationSeconds: 12, hasAudioStream: true }),
    remuxStripMetadata: jest.fn().mockResolvedValue(undefined),
  };
  const chatModerationCheck = {
    check: jest
      .fn()
      .mockResolvedValue({ allowed: overrides.moderationAllowed ?? true }),
  };

  const clipQb = makeQueryBuilder(overrides.clips ?? []);
  const videoClipRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(clipQb),
    save: jest.fn((entity: Record<string, unknown>) =>
      Promise.resolve({
        ...entity,
        id: 'clip-new',
        createdAt: new Date('2026-07-22T18:07:00Z'),
      }),
    ),
    create: jest.fn((entity: unknown) => entity),
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const clipReportRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((entity: unknown) =>
      Promise.resolve({ ...entity, id: 'report-1', createdAt: new Date() }),
    ),
    create: jest.fn((entity: unknown) => entity),
  };
  const teamChatBlockRepository = { find: jest.fn().mockResolvedValue([]) };
  const teamCoachRepository = { find: jest.fn().mockResolvedValue([]) };
  const coachRepository = { find: jest.fn().mockResolvedValue([]) };

  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  };

  const service = new VideoClipsService(
    configService as never,
    playersService as never,
    playerPrivateInfoService as never,
    teamsService as never,
    redisService as never,
    mailService as never,
    objectStorageService as never,
    videoProcessingService as never,
    chatModerationCheck,
    videoClipRepository as never,
    clipReportRepository as never,
    teamChatBlockRepository as never,
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
    objectStorageService,
    videoProcessingService,
    chatModerationCheck,
    clipQb,
    videoClipRepository,
    clipReportRepository,
    teamChatBlockRepository,
    teamCoachRepository,
    coachRepository,
    configService,
  };
}

describe('VideoClipsService.createUploadUrl', () => {
  it('rejects with consent_required before ever touching the rate limit', async () => {
    const { service, playersService, redisService } = buildService();
    playersService.assertTeamMembership.mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    });

    await expect(
      service.createUploadUrl('team-1', 'player-1', {
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
      }),
    ).rejects.toBeInstanceOf(ConsentRequiredException);
    expect(redisService.tryClaimClipUploadAllowance).not.toHaveBeenCalled();
  });

  it('rejects with clip_upload_rate_limited when the upload allowance is exhausted', async () => {
    const { service, redisService } = buildService();
    redisService.tryClaimClipUploadAllowance.mockResolvedValue(false);

    await expect(
      service.createUploadUrl('team-1', 'player-1', {
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
      }),
    ).rejects.toBeInstanceOf(ClipUploadRateLimitedException);
  });

  it('rejects a taggedPlayerId not on the same team with a plain 400', async () => {
    const { service, playersService } = buildService();
    playersService.findByIdOrThrow.mockResolvedValue({
      id: 'player-2',
      teamId: 'other-team',
    });

    await expect(
      service.createUploadUrl('team-1', 'player-1', {
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
        taggedPlayerId: 'player-2',
      }),
    ).rejects.toThrow();
  });

  it('rejects a filtered caption with caption_rejected_by_filter and never persists the clip', async () => {
    const { service, videoClipRepository } = buildService({
      moderationAllowed: false,
    });

    await expect(
      service.createUploadUrl('team-1', 'player-1', {
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
        caption: 'banned word',
      }),
    ).rejects.toBeInstanceOf(CaptionRejectedByFilterException);
    expect(videoClipRepository.save).not.toHaveBeenCalled();
  });

  it('persists a pending_upload row and returns a presigned PUT url on the happy path', async () => {
    const { service, videoClipRepository, objectStorageService } =
      buildService();

    const result = await service.createUploadUrl('team-1', 'player-1', {
      mimeType: 'video/mp4',
      fileSizeBytes: 1000,
      durationSeconds: 10,
      caption: 'Zorro-fint #47!',
    });

    expect(videoClipRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        uploaderPlayerId: 'player-1',
        status: VideoClipStatus.PENDING_UPLOAD,
      }),
    );
    // storage_key is server-generated and updated onto the row after
    // creation (ADR-0010 Decision 1) — never accepted as input.
    expect(videoClipRepository.update).toHaveBeenCalledWith(
      { id: 'clip-new' },
      { storageKey: 'clips/team-1/clip-new.mp4' },
    );
    expect(objectStorageService.createPresignedPutUrl).toHaveBeenCalledWith(
      'clips/team-1/clip-new.mp4',
      'video/mp4',
      expect.any(Number),
    );
    expect(result).toMatchObject({
      clipId: 'clip-new',
      uploadMethod: 'PUT',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
    });
  });
});

describe('VideoClipsService.completeUpload', () => {
  it('rejects with clip_not_found when no matching pending_upload row exists for this uploader/team', async () => {
    const { service, videoClipRepository } = buildService();
    videoClipRepository.findOne.mockResolvedValue(null);

    await expect(
      service.completeUpload('team-1', 'player-1', 'clip-1'),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
  });

  it('rejects with upload_not_found when the object never landed in storage', async () => {
    const { service, videoClipRepository, objectStorageService } =
      buildService();
    videoClipRepository.findOne.mockResolvedValue({
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-1',
      storageKey: 'clips/team-1/clip-1.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 10,
      createdAt: new Date(),
      caption: null,
      taggedPlayerId: null,
    });
    objectStorageService.headObject.mockResolvedValue(null);

    await expect(
      service.completeUpload('team-1', 'player-1', 'clip-1'),
    ).rejects.toBeInstanceOf(UploadNotFoundException);
  });

  it('rejects with clip_processing_failed when the metadata-stripping remux fails, deletes the bad object, and never flips status to published', async () => {
    const {
      service,
      videoClipRepository,
      videoProcessingService,
      objectStorageService,
    } = buildService();
    videoClipRepository.findOne.mockResolvedValue({
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-1',
      storageKey: 'clips/team-1/clip-1.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 10,
      createdAt: new Date(),
      caption: null,
      taggedPlayerId: null,
    });
    videoProcessingService.remuxStripMetadata.mockRejectedValue(
      new Error('ffmpeg exited with code 1'),
    );

    await expect(
      service.completeUpload('team-1', 'player-1', 'clip-1'),
    ).rejects.toBeInstanceOf(ClipProcessingFailedException);

    expect(objectStorageService.deleteObjectIfExists).toHaveBeenCalledWith(
      'clips/team-1/clip-1.mp4',
    );
    expect(videoClipRepository.update).not.toHaveBeenCalled();
    // Cleans up its own temp files even on the failure path.
    expect(videoProcessingService.deleteTempFileIfExists).toHaveBeenCalled();
  });

  it('publishes on the happy path: strips metadata, overwrites the object, sets expiresAt = createdAt + retentionDays, returns a fresh playback url', async () => {
    const createdAt = new Date('2026-07-22T18:07:00Z');
    const {
      service,
      videoClipRepository,
      objectStorageService,
      configService,
    } = buildService();
    configService.get.mockImplementation((key: string) =>
      key === 'CLIP_RETENTION_DAYS' ? '90' : undefined,
    );
    videoClipRepository.findOne.mockResolvedValue({
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-1',
      storageKey: 'clips/team-1/clip-1.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 10,
      createdAt,
      caption: 'Zorro-fint #47!',
      taggedPlayerId: null,
    });

    const result = await service.completeUpload('team-1', 'player-1', 'clip-1');

    expect(objectStorageService.putObjectBuffer).toHaveBeenCalledWith(
      'clips/team-1/clip-1.mp4',
      expect.any(Buffer),
      'video/mp4',
    );
    expect(videoClipRepository.update).toHaveBeenCalledWith(
      { id: 'clip-1' },
      expect.objectContaining({ status: VideoClipStatus.PUBLISHED }),
    );
    const expectedExpiresAt = new Date(
      createdAt.getTime() + 90 * 24 * 60 * 60 * 1000,
    );
    expect(result).toMatchObject({
      clipId: 'clip-1',
      status: 'published',
      playbackUrl: 'https://minio/get-url',
      caption: 'Zorro-fint #47!',
    });
    expect(result.expiresAt).toBe(expectedExpiresAt.toISOString());
  });
});

describe('VideoClipsService.listClips', () => {
  it('rejects with consent_required for a non-approved viewer', async () => {
    const { service, playersService } = buildService();
    playersService.assertTeamMembership.mockResolvedValue({
      id: 'player-1',
      teamId: 'team-1',
      parentalConsentStatus: ParentalConsentStatus.PENDING,
    });

    await expect(
      service.listClips('team-1', 'player-1', undefined, 20),
    ).rejects.toBeInstanceOf(ConsentRequiredException);
  });

  it('applies the status + per-viewer-block filters in the same query and marks reportedByMe per clip', async () => {
    const clipA = {
      id: 'clip-1',
      uploaderPlayerId: 'player-1',
      taggedPlayerId: null,
      caption: 'hej',
      storageKey: 'clips/team-1/clip-1.mp4',
      createdAt: new Date('2026-07-22T10:00:00Z'),
    };
    const { service, clipQb, clipReportRepository } = buildService({
      clips: [clipA],
    });
    clipReportRepository.find.mockResolvedValue([
      { clipId: 'clip-1', reporterPlayerId: 'player-1' },
    ]);

    const result = await service.listClips('team-1', 'player-1', undefined, 20);

    expect(clipQb.where).toHaveBeenCalledTimes(1);
    const andWhereSqlCalls = clipQb.andWhere.mock.calls.map(
      ([sql]: [string]) => sql,
    );
    expect(andWhereSqlCalls.some((sql) => sql.includes('status'))).toBe(true);
    expect(andWhereSqlCalls.some((sql) => sql.includes('NOT EXISTS'))).toBe(
      true,
    );
    expect(
      andWhereSqlCalls.some((sql) => sql.includes('uploader_player_id')),
    ).toBe(true);

    expect(result).toEqual([
      expect.objectContaining({
        clipId: 'clip-1',
        uploaderPlayerId: 'player-1',
        uploaderScreenName: 'FloorballStar15',
        caption: 'hej',
        playbackUrl: 'https://minio/get-url',
        reportedByMe: true,
      }),
    ]);
  });

  it('adds an additional created_at filter only when `before` is supplied', async () => {
    const { service, clipQb } = buildService({ clips: [] });
    await service.listClips('team-1', 'player-1', undefined, 20);
    let calls = clipQb.andWhere.mock.calls.map(([sql]: [string]) => sql);
    expect(calls.some((sql) => sql.includes('created_at <'))).toBe(false);

    await service.listClips('team-1', 'player-1', '2026-07-22T00:00:00Z', 20);
    calls = clipQb.andWhere.mock.calls.map(([sql]: [string]) => sql);
    expect(calls.some((sql) => sql.includes('created_at <'))).toBe(true);
  });
});

describe('VideoClipsService.deleteClip', () => {
  it('rejects with clip_not_found for a nonexistent (or cross-team) clip', async () => {
    const { service, videoClipRepository } = buildService();
    videoClipRepository.findOne.mockResolvedValue(null);

    await expect(
      service.deleteClip('team-1', 'player-1', 'clip-1'),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
  });

  it('rejects with not_your_clip when the requester is not the uploader', async () => {
    const { service, videoClipRepository } = buildService();
    videoClipRepository.findOne.mockResolvedValue({
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-2',
      storageKey: 'clips/team-1/clip-1.mp4',
    });

    await expect(
      service.deleteClip('team-1', 'player-1', 'clip-1'),
    ).rejects.toBeInstanceOf(NotYourClipException);
  });

  it('hard-deletes the object then the row on the happy path', async () => {
    const { service, videoClipRepository, objectStorageService } =
      buildService();
    videoClipRepository.findOne.mockResolvedValue({
      id: 'clip-1',
      teamId: 'team-1',
      uploaderPlayerId: 'player-1',
      storageKey: 'clips/team-1/clip-1.mp4',
    });

    const result = await service.deleteClip('team-1', 'player-1', 'clip-1');

    expect(objectStorageService.deleteObjectIfExists).toHaveBeenCalledWith(
      'clips/team-1/clip-1.mp4',
    );
    expect(videoClipRepository.delete).toHaveBeenCalledWith({ id: 'clip-1' });
    expect(result).toEqual({ clipId: 'clip-1', deleted: true });
  });
});

describe('VideoClipsService.reportClip', () => {
  const clip = {
    id: 'clip-1',
    teamId: 'team-1',
    uploaderPlayerId: 'player-2',
    storageKey: 'clips/team-1/clip-1.mp4',
  };

  it('rejects with clip_not_found for a nonexistent/non-published/cross-team clip', async () => {
    const { service, videoClipRepository } = buildService();
    videoClipRepository.findOne.mockResolvedValue(null);

    await expect(
      service.reportClip('team-1', 'player-1', 'clip-1', {
        reason: 'other' as never,
      }),
    ).rejects.toBeInstanceOf(ClipNotFoundException);
  });

  it('rejects an already-reported clip with 409 WITHOUT ever claiming the report cooldown', async () => {
    const { service, videoClipRepository, clipReportRepository, redisService } =
      buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);
    clipReportRepository.findOne.mockResolvedValue({
      id: 'existing-report',
      clipId: 'clip-1',
      reporterPlayerId: 'player-1',
    });

    await expect(
      service.reportClip('team-1', 'player-1', 'clip-1', {
        reason: 'other' as never,
      }),
    ).rejects.toBeInstanceOf(ClipAlreadyReportedException);
    expect(redisService.tryClaimClipReportCooldown).not.toHaveBeenCalled();
  });

  it('rejects with clip_report_rate_limited once the cooldown is claimed elsewhere', async () => {
    const { service, videoClipRepository, redisService } = buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);
    redisService.tryClaimClipReportCooldown.mockResolvedValue(false);

    await expect(
      service.reportClip('team-1', 'player-1', 'clip-1', {
        reason: 'other' as never,
      }),
    ).rejects.toBeInstanceOf(ClipReportRateLimitedException);
  });

  it('persists the report AND immediately hides the clip (ADR-0010 Decision 4 — the divergence from chat)', async () => {
    const { service, videoClipRepository } = buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);

    const result = await service.reportClip('team-1', 'player-1', 'clip-1', {
      reason: 'bullying' as never,
    });

    expect(result).toEqual({
      reportId: 'report-1',
      clipId: 'clip-1',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
      createdAt: expect.any(String),
    });
    expect(videoClipRepository.update).toHaveBeenCalledWith(
      { id: 'clip-1' },
      { status: VideoClipStatus.HIDDEN },
    );
  });

  it("sends the best-effort notification email to the uploader's parent when the 24h cooldown allows it", async () => {
    const { service, videoClipRepository, mailService } = buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);

    await service.reportClip('team-1', 'player-1', 'clip-1', {
      reason: 'other' as never,
    });

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com' }),
    );
  });

  it('does not send (and does not throw) when the 24h notify cooldown is already claimed', async () => {
    const { service, videoClipRepository, redisService, mailService } =
      buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);
    redisService.tryClaimClipReportNotifyCooldown.mockResolvedValue(false);

    await expect(
      service.reportClip('team-1', 'player-1', 'clip-1', {
        reason: 'other' as never,
      }),
    ).resolves.toBeDefined();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('never fails the request even if the mail send throws (best-effort)', async () => {
    const { service, videoClipRepository, mailService } = buildService();
    videoClipRepository.findOne.mockResolvedValue(clip);
    mailService.sendMail.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.reportClip('team-1', 'player-1', 'clip-1', {
        reason: 'other' as never,
      }),
    ).resolves.toBeDefined();
  });
});

describe('VideoClipStatus', () => {
  it('is pending_upload by default (per the entity)', () => {
    expect(VideoClipStatus.PENDING_UPLOAD).toBe('pending_upload');
    expect(VideoClipStatus.PUBLISHED).toBe('published');
    expect(VideoClipStatus.HIDDEN).toBe('hidden');
  });
});
