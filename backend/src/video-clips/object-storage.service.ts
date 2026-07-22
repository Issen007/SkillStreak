import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import {
  CLIP_MAX_FILE_SIZE_BYTES,
  DEFAULT_CLIP_BUCKET,
} from './video-clip.constants';

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
      );
    }
    return Buffer.concat(chunks);
  }
  // Can't occur against a real S3-API object store — GetObjectCommand's
  // Body is always a Node Readable in this runtime (the AWS SDK's
  // web-stream/blob variants are browser-only code paths this app never
  // takes). Surfaced as a 500, not defended against as normal input.
  throw new Error('Expected a Node Readable stream from GetObjectCommand.');
}

// docs/adr/0010-video-storage-and-serving.md Decision 1/2 — a thin wrapper
// around the S3-API client talking to the self-hosted MinIO service. Every
// method here is a plain, structural operation against one already-known
// storage_key; the *authorization* decision (does this requester's team own
// this clip) always happens one layer up, in VideoClipsService, before this
// service is ever called — mirrors how PlayersService.assertTeamMembership
// gates every team-scoped read/write before any Postgres query runs.
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket =
      this.configService.get<string>('MINIO_BUCKET') ?? DEFAULT_CLIP_BUCKET;
    this.client = new S3Client({
      endpoint: this.configService.get<string>('MINIO_ENDPOINT'),
      region: 'us-east-1', // arbitrary — MinIO ignores region, the SDK requires one.
      forcePathStyle: true, // required for MinIO's path-style bucket addressing.
      credentials: {
        accessKeyId: this.configService.get<string>('MINIO_ACCESS_KEY') ?? '',
        secretAccessKey:
          this.configService.get<string>('MINIO_SECRET_KEY') ?? '',
      },
    });
  }

  /**
   * Creates the `clips` bucket on first boot if it doesn't already exist —
   * lets a fresh local/CI MinIO instance work with no manual provisioning
   * step, the same "no manual step needed" posture TypeORM's own
   * auto-`CREATE EXTENSION IF NOT EXISTS` gives pgcrypto. Never grants any
   * public/anonymous read policy (ADR-0010 Decision 2) — MinIO buckets are
   * private by default, and this method does nothing to change that.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!(error instanceof NotFound)) {
        this.logger.warn(
          `Could not confirm bucket "${this.bucket}" exists: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created MinIO bucket "${this.bucket}".`);
    }
    await this.configureMaxObjectSizePolicy();
  }

  /**
   * ADR-0010 Decision 1 (security-reviewer finding) — "configure the
   * bucket/policy with a maximum object size matching Decision 3's
   * declared fileSizeBytes cap." A presigned PUT can't itself enforce
   * `Content-Length` server-side, so this would be real defense in depth,
   * not redundant with the request-time validation `CreateUploadUrlDto`
   * already does — a bucket policy `Deny` on `s3:content-length-range` is
   * the standard AWS S3 mechanism for this (a `Deny` always wins over an
   * `Allow`, including one implied by a valid presigned URL's signature).
   *
   * **Verified against a real MinIO instance (`minio/minio:latest`,
   * confirmed both via this exact call and independently via `mc admin
   * policy create`) that this does NOT currently work: MinIO's policy
   * engine rejects `s3:content-length-range` outright as "invalid
   * condition key," not merely "doesn't enforce it silently."** This is a
   * known, verified gap, not an oversight glossed over — flagged for
   * security-reviewer/the project owner, same "state plainly what's true"
   * posture this codebase already applies to its other residual risks
   * (e.g. ADR-0010's own presigned-URL-copy-paste gap). The call below is
   * kept as a harmless best-effort attempt (logs a warning and falls back
   * cleanly, never breaks the upload path) rather than removed outright,
   * because: (a) real AWS S3 does document support for this condition key,
   * so this becomes a real, working control for free if this project ever
   * moves off self-hosted MinIO onto AWS S3 per ADR-0010's own portability
   * framing; (b) a future MinIO release may add support. **Until then, the
   * *only* active control against an oversized PUT to a leaked presigned
   * URL is the primary one the ADR already names**: the API only ever
   * hands out one rate-limited, validated presigned URL per request — this
   * bucket-policy layer is not currently adding anything on top of that on
   * MinIO, and should not be assumed to.
   */
  private async configureMaxObjectSizePolicy(): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DenyOversizedClipUploads',
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:PutObject',
          Resource: `arn:aws:s3:::${this.bucket}/*`,
          Condition: {
            NumericGreaterThan: {
              's3:content-length-range': String(CLIP_MAX_FILE_SIZE_BYTES),
            },
          },
        },
      ],
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify(policy),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not set the max-object-size bucket policy on "${this.bucket}" — falling back to app-level validation only: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async createPresignedPutUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  /** Minted fresh on every call — never cached/reused across requests
   * (ADR-0010 Decision 2). */
  async createPresignedGetUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  /** Returns null if no object exists at this key (the presigned PUT never
   * arrived) — callers translate that into `409 upload_not_found`. */
  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return streamToBuffer(result.Body);
  }

  /** Overwrites (or creates) the object at this key — used at `complete` to
   * replace the client-uploaded original with the metadata-stripped remux,
   * at the same storage_key (ADR-0010 Decision 3: "the remuxed file
   * replaces the originally-uploaded object... the client-uploaded
   * original is never itself exposed via a playback URL"). */
  async putObjectBuffer(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Delete-if-exists — S3's DeleteObject is itself idempotent (a delete of
   * a nonexistent key is not an error), so most callers never even hit the
   * catch branch; kept defensive to mirror every other cleanup path in this
   * codebase treating "already gone" as success, not failure. Used by both
   * self-delete and the retention/pending-upload sweeps (ADR-0010
   * Decision 5). */
  async deleteObjectIfExists(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      if (error instanceof NotFound) return;
      throw error;
    }
  }
}
