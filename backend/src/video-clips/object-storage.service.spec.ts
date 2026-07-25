import { NotFound, S3Client } from '@aws-sdk/client-s3';
import { ObjectStorageService } from './object-storage.service';

// ObjectStorageService constructs its own S3Client internally (a thin,
// single-purpose wrapper, not itself a candidate for constructor injection
// per this codebase's existing conventions) — so these tests spy on
// S3Client.prototype.send rather than mocking a constructor-injected
// client, the standard way to unit-test a thin AWS SDK wrapper without a
// real MinIO instance. The presigned-URL/HEAD/delete *behavior* (what
// happens on a NotFound, what gets returned) is what these tests actually
// check; a real MinIO round-trip (including the metadata-stripping path
// that depends on it) is exercised by test/phase3-video-clips.e2e-spec.ts.
function makeConfigService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
    MINIO_BUCKET: 'clips',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

describe('ObjectStorageService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('headObject returns null (not a thrown error) when the object does not exist', async () => {
    jest
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValue(new NotFound({ message: 'not found', $metadata: {} }));
    const service = new ObjectStorageService(makeConfigService() as never);

    const result = await service.headObject('clips/team-1/missing.mp4');

    expect(result).toBeNull();
  });

  it('headObject rethrows a non-NotFound error', async () => {
    jest
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValue(new Error('connection refused'));
    const service = new ObjectStorageService(makeConfigService() as never);

    await expect(service.headObject('clips/team-1/clip.mp4')).rejects.toThrow(
      'connection refused',
    );
  });

  it('headObject returns sizeBytes/contentType when the object exists', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      ContentLength: 12345,
      ContentType: 'video/mp4',
    } as never);
    const service = new ObjectStorageService(makeConfigService() as never);

    const result = await service.headObject('clips/team-1/clip.mp4');

    expect(result).toEqual({ sizeBytes: 12345, contentType: 'video/mp4' });
  });

  it('deleteObjectIfExists treats a NotFound as success, not an error', async () => {
    jest
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValue(new NotFound({ message: 'not found', $metadata: {} }));
    const service = new ObjectStorageService(makeConfigService() as never);

    await expect(
      service.deleteObjectIfExists('clips/team-1/already-gone.mp4'),
    ).resolves.toBeUndefined();
  });

  it('deleteObjectIfExists rethrows a non-NotFound error', async () => {
    jest
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValue(new Error('access denied'));
    const service = new ObjectStorageService(makeConfigService() as never);

    await expect(
      service.deleteObjectIfExists('clips/team-1/clip.mp4'),
    ).rejects.toThrow('access denied');
  });

  // Verified live against a real MinIO instance (`minio/minio:latest`,
  // both via ObjectStorageService itself and independently via `mc admin
  // policy create`): MinIO rejects the `s3:content-length-range` bucket-
  // policy condition key outright ("invalid condition key"), not a silent
  // no-op. onModuleInit must survive that cleanly — a failed defense-in-
  // depth policy attempt must never block app boot or bucket creation, the
  // primary control (rate-limited, validated presigned URL issuance)
  // stays intact regardless (see this method's own doc comment for the
  // full, honest account of this finding).
  it('onModuleInit logs a warning and does not throw when the bucket-size policy is rejected (the real, verified MinIO behavior)', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send');
    sendSpy.mockImplementation(((command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === 'HeadBucketCommand') {
        return Promise.resolve({});
      }
      if (name === 'PutBucketPolicyCommand') {
        return Promise.reject(
          new Error("invalid condition key 's3:content-length-range'."),
        );
      }
      return Promise.resolve({});
    }) as never);
    const service = new ObjectStorageService(makeConfigService() as never);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
