import { ClipRetentionService } from './clip-retention.service';
import { VideoClipStatus } from './entities/video-clip.entity';

function buildService(overrides: { configValue?: string } = {}) {
  const configService = {
    get: jest.fn().mockReturnValue(overrides.configValue),
  };
  const videoClipRepository = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const objectStorageService = {
    deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ClipRetentionService(
    configService as never,
    videoClipRepository as never,
    objectStorageService as never,
  );

  return { service, configService, videoClipRepository, objectStorageService };
}

describe('ClipRetentionService.sweepExpiredPublishedClips', () => {
  it('queries published clips past expiresAt, deletes the object before the row, for each', async () => {
    const row = { id: 'clip-1', storageKey: 'clips/team-1/clip-1.mp4' };
    const { service, videoClipRepository, objectStorageService } =
      buildService();
    videoClipRepository.find.mockResolvedValue([row]);

    await service.sweepExpiredPublishedClips();

    const [[{ where: expiredWhere }]] = videoClipRepository.find.mock.calls as [
      [{ where: { status: VideoClipStatus } }],
    ];
    expect(expiredWhere.status).toBe(VideoClipStatus.PUBLISHED);
    expect(objectStorageService.deleteObjectIfExists).toHaveBeenCalledWith(
      'clips/team-1/clip-1.mp4',
    );
    expect(videoClipRepository.delete).toHaveBeenCalledWith({ id: 'clip-1' });

    // Object deletion happened before the row delete — the safer failure
    // direction per ADR-0010 Decision 5 (an orphaned object is harmless
    // waste; a row with no confirmed-deleted object is a live task item).
    const deleteObjectOrder =
      objectStorageService.deleteObjectIfExists.mock.invocationCallOrder[0];
    const deleteRowOrder =
      videoClipRepository.delete.mock.invocationCallOrder[0];
    expect(deleteObjectOrder).toBeLessThan(deleteRowOrder);
  });

  it('leaves the row alone for the next run if object deletion fails transiently', async () => {
    const row = { id: 'clip-1', storageKey: 'clips/team-1/clip-1.mp4' };
    const { service, videoClipRepository, objectStorageService } =
      buildService();
    videoClipRepository.find.mockResolvedValue([row]);
    objectStorageService.deleteObjectIfExists.mockRejectedValue(
      new Error('minio unreachable'),
    );

    await service.sweepExpiredPublishedClips();

    expect(videoClipRepository.delete).not.toHaveBeenCalled();
  });

  it('does nothing when no rows are due', async () => {
    const { service, objectStorageService, videoClipRepository } =
      buildService();

    await service.sweepExpiredPublishedClips();

    expect(objectStorageService.deleteObjectIfExists).not.toHaveBeenCalled();
    expect(videoClipRepository.delete).not.toHaveBeenCalled();
  });
});

describe('ClipRetentionService.sweepAbandonedPendingUploads', () => {
  it('queries pending_upload clips past the TTL (default 60 minutes) and sweeps each', async () => {
    const row = { id: 'clip-2', storageKey: 'clips/team-1/clip-2.mp4' };
    const { service, videoClipRepository, objectStorageService } =
      buildService();
    videoClipRepository.find.mockResolvedValue([row]);

    await service.sweepAbandonedPendingUploads();

    const [[{ where: pendingWhere }]] = videoClipRepository.find.mock.calls as [
      [{ where: { status: VideoClipStatus } }],
    ];
    expect(pendingWhere.status).toBe(VideoClipStatus.PENDING_UPLOAD);
    expect(objectStorageService.deleteObjectIfExists).toHaveBeenCalledWith(
      'clips/team-1/clip-2.mp4',
    );
    expect(videoClipRepository.delete).toHaveBeenCalledWith({ id: 'clip-2' });
  });

  it('honors CLIP_PENDING_UPLOAD_TTL_MINUTES when set', async () => {
    const { service, videoClipRepository, configService } = buildService({
      configValue: '120',
    });

    const before = Date.now();
    await service.sweepAbandonedPendingUploads();
    const after = Date.now();

    expect(configService.get).toHaveBeenCalledWith(
      'CLIP_PENDING_UPLOAD_TTL_MINUTES',
    );
    const [[{ where }]] = videoClipRepository.find.mock.calls as [
      [{ where: { createdAt: { _value: Date } } }],
    ];
    // TypeORM's LessThan() wraps the cutoff Date in a FindOperator whose
    // internal value isn't part of the public API to assert on directly —
    // instead, sanity-check the cutoff is ~120 minutes in the past relative
    // to when this test ran, not the default 60.
    const cutoff = where.createdAt._value;
    const cutoffMs = cutoff.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 120 * 60_000 - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 120 * 60_000 + 1000);
  });
});
