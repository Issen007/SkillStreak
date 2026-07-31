import {
  BucketAlreadyExists,
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutBucketCorsCommand,
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
  // Signs presigned URLs against the endpoint a real client (phone,
  // browser) can actually reach — see env.validation.ts's
  // MINIO_PUBLIC_ENDPOINT comment. Same credentials/bucket, only the
  // endpoint differs, so this is a second lightweight client, not a
  // second connection pool to a different service.
  private readonly publicUrlClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket =
      this.configService.get<string>('MINIO_BUCKET') ?? DEFAULT_CLIP_BUCKET;
    const credentials = {
      accessKeyId: this.configService.get<string>('MINIO_ACCESS_KEY') ?? '',
      secretAccessKey: this.configService.get<string>('MINIO_SECRET_KEY') ?? '',
    };
    this.client = new S3Client({
      endpoint: this.configService.get<string>('MINIO_ENDPOINT'),
      region: 'us-east-1', // arbitrary — MinIO ignores region, the SDK requires one.
      forcePathStyle: true, // required for MinIO's path-style bucket addressing.
      credentials,
    });
    this.publicUrlClient = new S3Client({
      endpoint:
        this.configService.get<string>('MINIO_PUBLIC_ENDPOINT') ??
        this.configService.get<string>('MINIO_ENDPOINT'),
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
    });
  }

  /**
   * Creates the `clips` bucket on first boot if it doesn't already exist —
   * lets a fresh local/CI MinIO instance work with no manual provisioning
   * step, the same "no manual step needed" posture TypeORM's own
   * auto-`CREATE EXTENSION IF NOT EXISTS` gives pgcrypto. Never grants any
   * public/anonymous read policy (ADR-0010 Decision 2) — MinIO buckets are
   * private by default, and this method does nothing to change that.
   *
   * HEAD-then-CREATE is a check-then-act race: CI runs multiple e2e test
   * files as separate Jest workers, each bootstrapping its own Nest app
   * against the same shared MinIO instance, so two instances can both see
   * the bucket missing and both attempt to create it. Confirmed live: this
   * threw BucketAlreadyOwnedByYou on a real CI run and failed that entire
   * suite's app bootstrap (every test in the file failed as a result, not
   * just bucket setup). BucketAlreadyOwnedByYou/BucketAlreadyExists are
   * both treated as "the bucket exists, which is all this method actually
   * wants" — not re-thrown.
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
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created MinIO bucket "${this.bucket}".`);
      } catch (createError) {
        if (
          createError instanceof BucketAlreadyOwnedByYou ||
          createError instanceof BucketAlreadyExists
        ) {
          this.logger.log(
            `Bucket "${this.bucket}" was created concurrently by another instance — continuing.`,
          );
        } else {
          throw createError;
        }
      }
    }
    await this.configureMaxObjectSizePolicy();
    await this.configureCorsPolicy();
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
   * framing (see docs/BACKLOG.md's Safespring S3 entry); (b) a future
   * MinIO release may add support.
   *
   * **Narrower residual gap than it looks in isolation, 2026-07-30**: two
   * independent app-level controls already close most of what this policy
   * would have added. `VideoClipsService.completeUpload` HEADs the real
   * uploaded object and deletes+rejects it (before ever buffering it into
   * memory) if its actual size/content-type don't match what was
   * declared, and `ClipRetentionService`'s sweep deletes any abandoned
   * `pending_upload` row — completed or not — after
   * `CLIP_PENDING_UPLOAD_TTL_MINUTES` (default 60). An oversized PUT to a
   * leaked presigned URL can never become a servable clip either way —
   * what's genuinely uncovered is the storage/bandwidth spent during the
   * PUT itself and until one of those two cleanups runs: a real but
   * transient-cost risk, not a "the file gets served" risk.
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
      // error, not warn — this is a known, permanent limitation (not
      // transient), and should stay visible to monitoring without anyone
      // needing to already suspect it's broken. See the class comment
      // above for why this is a narrower gap than it sounds in isolation.
      this.logger.error(
        `Could not set the max-object-size bucket policy on "${this.bucket}" ` +
          '(this MinIO instance does not support the s3:content-length-range ' +
          'condition key) — the completeUpload size/type check and the ' +
          `pending-upload retention sweep still prevent an oversized clip from ` +
          `ever being served: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  /**
   * The clip picker/uploader (`mobile/src/clips/upload/`) runs unmodified
   * on web (the "try it" site, `try.skillstreak.xyz`) via react-native-web,
   * where the presigned `PUT` in Decision 3's two-phase upload is a real
   * cross-origin browser request from the site's own origin straight to
   * this bucket's endpoint — subject to the browser's CORS enforcement,
   * unlike the native app's direct native-module HTTP call. Confirmed live
   * 2026-07-31 as the root cause of every web upload failing with a
   * generic "connection" error: no CORS configuration existed on the
   * bucket at all, so the browser blocked the `PUT` (and its preflight
   * `OPTIONS`) before it ever reached Safespring/MinIO — nothing to do
   * with connectivity, credentials, or the S3 provider migration itself.
   *
   * Reuses `CORS_ORIGIN` — the exact same env var and origin list
   * `main.ts`'s `app.enableCors` already trusts for the API itself, per
   * environment (production's real domains vs. the internal cluster's LAN
   * `try-it` URL, each cluster's own ConfigMap) — not a second, parallel
   * origin list to keep in sync by hand. Skipped entirely when unset (mirrors
   * `main.ts`'s own "off by default" posture), which is fine: local/CI
   * MinIO is only ever driven by the SDK/curl directly, never a real
   * browser, so no CORS policy is needed there either.
   *
   * Best-effort, matching `configureMaxObjectSizePolicy`'s own posture —
   * logged loudly on failure rather than crashing boot, since a self-hosted
   * MinIO too old to support `PutBucketCors` should degrade to "web upload
   * doesn't work, native app still does," not "the API won't start."
   *
   * `PUT` only, deliberately not `GET`/`HEAD` (security-reviewer finding,
   * 2026-07-31): clip *playback* on web is a plain `<video>`-element-style
   * load of the presigned GET URL (`ClipCard`'s `useVideoPlayer`), which
   * browsers don't subject to CORS at all — no code path here does a
   * `fetch`/`XHR` read of clip bytes that would need it. Add `GET` back
   * only if/when that becomes true, not preemptively.
   */
  private async configureCorsPolicy(): Promise<void> {
    const corsOrigin = this.configService.get<string>('CORS_ORIGIN');
    if (!corsOrigin) return;
    const allowedOrigins = corsOrigin.split(',').map((o) => o.trim());
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: allowedOrigins,
                AllowedMethods: ['PUT'],
                AllowedHeaders: ['*'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Could not set a CORS policy on bucket "${this.bucket}" for origins ` +
          `[${allowedOrigins.join(', ')}] — clip upload from a browser (the ` +
          `"try it" site) will fail until this is resolved; the native app is ` +
          `unaffected: ${error instanceof Error ? error.message : String(error)}`,
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
    return getSignedUrl(this.publicUrlClient, command, {
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
    return getSignedUrl(this.publicUrlClient, command, {
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
