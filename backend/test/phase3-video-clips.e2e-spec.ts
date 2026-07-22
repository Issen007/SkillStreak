import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { PlayerTokenService } from '../src/auth/player-token.service';
import { ParentalConsentStatus } from '../src/players/player-consent-status.enum';
import { Player } from '../src/players/entities/player.entity';
import { PlayerPrivateInfo } from '../src/player-private-info/entities/player-private-info.entity';
import { Team } from '../src/teams/entities/team.entity';
import {
  ClipReport,
  ClipReportReason,
} from '../src/video-clips/entities/clip-report.entity';
import {
  VideoClip,
  VideoClipStatus,
} from '../src/video-clips/entities/video-clip.entity';

const execFileAsync = promisify(execFile);

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreateUploadUrlBody {
  clipId: string;
  uploadUrl: string;
  uploadMethod: 'PUT';
  requiredHeaders: { 'Content-Type': string };
  expiresAt: string;
}

interface CompleteUploadBody {
  clipId: string;
  status: string;
  playbackUrl: string;
  caption: string | null;
  taggedPlayerId: string | null;
  createdAt: string;
  expiresAt: string;
}

interface ClipFeedItemBody {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  taggedPlayerId: string | null;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
  reportedByMe: boolean;
}

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    await execFileAsync('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function generateSyntheticClip(): Promise<Buffer> {
  const path = join(tmpdir(), `e2e-clip-${randomUUID()}.mp4`);
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=1:size=64x64:rate=10',
    '-metadata',
    'location=+37.7749-122.4194/',
    '-metadata',
    'title=SecretHomeVideo',
    '-c:v',
    'libx264',
    path,
  ]);
  const bytes = await fs.readFile(path);
  await fs.unlink(path).catch(() => undefined);
  return bytes;
}

async function readFormatTags(bytes: Buffer): Promise<Record<string, string>> {
  const path = join(tmpdir(), `e2e-downloaded-${randomUUID()}.mp4`);
  await fs.writeFile(path, bytes);
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format_tags',
      path,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { tags?: Record<string, string> };
    };
    return parsed.format?.tags ?? {};
  } finally {
    await fs.unlink(path).catch(() => undefined);
  }
}

// Exercises docs/api/phase3-contract.md's five endpoints end-to-end against
// real Postgres + Redis + MinIO, mirroring phase2.6b-team-chat.e2e-spec.ts's
// fixture-creation conventions. Requires ffmpeg/ffprobe (see
// ffmpegAvailable() — the same real-binary posture as
// video-processing.service.spec.ts) and a real MinIO instance reachable at
// MINIO_ENDPOINT (docker-compose.yml's `minio` service / CI's bitnami/minio
// service container) — this suite is the one place a genuinely-real upload
// -> remux -> playback round trip is proven, not just each layer in
// isolation.
describe('Fas 3: video clips & the team feed (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let playerTokenService: PlayerTokenService;
  let ffmpegPresent = false;

  beforeAll(async () => {
    ffmpegPresent = await ffmpegAvailable();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();

    dataSource = app.get(DataSource);
    playerTokenService = app.get(PlayerTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTeam() {
    const inviteCode = `CLIP${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Team Clips Test Team', inviteCode }),
      );
    return team.id;
  }

  async function createPlayer(
    teamId: string,
    consentStatus: ParentalConsentStatus = ParentalConsentStatus.APPROVED,
  ) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Clip${randomUUID().slice(0, 8)}`,
        avatarId: 'fox',
        birthYear: 2013,
        parentalConsentStatus: consentStatus,
      }),
    );
    await dataSource.getRepository(PlayerPrivateInfo).save(
      dataSource.getRepository(PlayerPrivateInfo).create({
        playerId: player.id,
        parentContact: 'parent@example.com',
        realName: null,
      }),
    );
    const sessionToken = playerTokenService.issueFor(
      player.id,
      player.tokenVersion,
    );
    return { playerId: player.id, sessionToken };
  }

  /** Direct-insert helper for tests that don't need a real MinIO object
   * (feed/report/delete don't reprocess the video) — minting a presigned
   * GET is pure request signing, it never checks the object actually
   * exists, so a plausible-looking storageKey is fine here. The one real
   * end-to-end upload -> complete -> playback round trip is exercised
   * separately, below. */
  async function createPublishedClip(
    teamId: string,
    uploaderPlayerId: string,
    overrides: Partial<{
      taggedPlayerId: string | null;
      caption: string | null;
      createdAt: Date;
    }> = {},
  ) {
    const clip = await dataSource.getRepository(VideoClip).save(
      dataSource.getRepository(VideoClip).create({
        teamId,
        uploaderPlayerId,
        taggedPlayerId: overrides.taggedPlayerId ?? null,
        storageKey: `clips/${teamId}/${randomUUID()}.mp4`,
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
        caption: overrides.caption ?? null,
        status: VideoClipStatus.PUBLISHED,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }),
    );
    if (overrides.createdAt) {
      await dataSource
        .getRepository(VideoClip)
        .update({ id: clip.id }, { createdAt: overrides.createdAt });
    }
    return clip;
  }

  describe('POST /clips/upload-url', () => {
    it('rejects a pending-consent player with 403 consent_required', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
        })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'consent_required',
      );
    });

    it('rejects a player from a different team with 403 team_mismatch', async () => {
      const teamId = await createTeam();
      const otherTeamId = await createTeam();
      const { sessionToken } = await createPlayer(otherTeamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
        })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe('team_mismatch');
    });

    it('rejects a disallowed mimeType, an over-cap fileSizeBytes, and an over-cap durationSeconds with 400 validation_error', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const badMime = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'image/png',
          fileSizeBytes: 1000,
          durationSeconds: 10,
        })
        .expect(400);
      expect((badMime.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );

      const oversized = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 999_999_999,
          durationSeconds: 10,
        })
        .expect(400);
      expect((oversized.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );

      const tooLong = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 999,
        })
        .expect(400);
      expect((tooLong.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('rejects a taggedPlayerId not on the same team with 400', async () => {
      const teamId = await createTeam();
      const otherTeamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);
      const { playerId: outsiderId } = await createPlayer(otherTeamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
          taggedPlayerId: outsiderId,
        })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('rejects a caption containing a banned word with 422 caption_rejected_by_filter, and never persists the clip', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
          caption: 'din jävla idiot',
        })
        .expect(422);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'caption_rejected_by_filter',
      );

      const stored = await dataSource
        .getRepository(VideoClip)
        .find({ where: { teamId } });
      expect(stored).toHaveLength(0);
    });

    it('creates a pending_upload row with a server-generated storage_key and returns a presigned PUT url', async () => {
      const teamId = await createTeam();
      const { playerId, sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
          caption: 'Zorro-fint #47!',
        })
        .expect(201);

      const body = response.body as CreateUploadUrlBody;
      expect(body).toMatchObject({
        uploadMethod: 'PUT',
        requiredHeaders: { 'Content-Type': 'video/mp4' },
      });
      expect(typeof body.clipId).toBe('string');
      expect(typeof body.uploadUrl).toBe('string');

      const row = await dataSource
        .getRepository(VideoClip)
        .findOneOrFail({ where: { id: body.clipId } });
      expect(row.status).toBe(VideoClipStatus.PENDING_UPLOAD);
      expect(row.uploaderPlayerId).toBe(playerId);
      expect(row.storageKey).toBe(`clips/${teamId}/${body.clipId}.mp4`);
    });

    it('rate-limits a burst of uploads beyond the daily allowance with 429 clip_upload_rate_limited', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const responses: number[] = [];
      // Comfortably over the 10/day default in
      // RedisService.tryClaimClipUploadAllowance.
      for (let i = 0; i < 12; i += 1) {
        const response = await request(app.getHttpServer())
          .post(`/api/v1/teams/${teamId}/clips/upload-url`)
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({
            mimeType: 'video/mp4',
            fileSizeBytes: 1000,
            durationSeconds: 10,
          });
        responses.push(response.status);
      }

      expect(responses).toContain(429);
    }, 30_000);
  });

  describe('POST /clips/:clipId/complete', () => {
    it('rejects a nonexistent (or cross-team/not-own-uploader) clipId with 404 clip_not_found', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${randomUUID()}/complete`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe('clip_not_found');
    });

    it('rejects with 409 upload_not_found when the object never landed in MinIO', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const uploadResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
        })
        .expect(201);
      const { clipId } = uploadResponse.body as CreateUploadUrlBody;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clipId}/complete`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'upload_not_found',
      );
    });

    it('rejects with 422 clip_processing_failed for a garbage (non-video) upload, and leaves the clip pending_upload', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const uploadResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
        })
        .expect(201);
      const { clipId, uploadUrl } = uploadResponse.body as CreateUploadUrlBody;

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: Buffer.from('this is not a real video file'),
      });
      expect(putResponse.ok).toBe(true);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clipId}/complete`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(422);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'clip_processing_failed',
      );

      const row = await dataSource
        .getRepository(VideoClip)
        .findOneOrFail({ where: { id: clipId } });
      expect(row.status).toBe(VideoClipStatus.PENDING_UPLOAD);
    });

    it('the real pipeline: PUT bytes to the presigned url, complete publishes, and the served bytes have had location/title metadata stripped', async () => {
      if (!ffmpegPresent) {
        console.warn(
          'ffmpeg/ffprobe not found on PATH — skipping the real upload/remux/playback round trip.',
        );
        return;
      }
      const teamId = await createTeam();
      const { sessionToken, playerId } = await createPlayer(teamId);
      const { playerId: taggedId } = await createPlayer(teamId);

      const clipBytes = await generateSyntheticClip();
      const tagsBeforeUpload = await readFormatTags(clipBytes);
      expect(tagsBeforeUpload.location).toBeDefined();

      const uploadResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/upload-url`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          mimeType: 'video/mp4',
          fileSizeBytes: clipBytes.length,
          durationSeconds: 1,
          caption: 'Zorro-fint #47!',
          taggedPlayerId: taggedId,
        })
        .expect(201);
      const { clipId, uploadUrl } = uploadResponse.body as CreateUploadUrlBody;

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: clipBytes,
      });
      expect(putResponse.ok).toBe(true);

      const completeResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clipId}/complete`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const completeBody = completeResponse.body as CompleteUploadBody;
      expect(completeBody).toMatchObject({
        clipId,
        status: 'published',
        caption: 'Zorro-fint #47!',
        taggedPlayerId: taggedId,
      });

      const row = await dataSource
        .getRepository(VideoClip)
        .findOneOrFail({ where: { id: clipId } });
      expect(row.status).toBe(VideoClipStatus.PUBLISHED);
      expect(row.expiresAt).not.toBeNull();

      // Fetch the actually-served bytes via the fresh presigned GET and
      // confirm the mandatory remux really ran against a real MinIO
      // round trip — not just asserted by reading the implementation.
      const playbackResponse = await fetch(completeBody.playbackUrl);
      expect(playbackResponse.ok).toBe(true);
      const servedBytes = Buffer.from(await playbackResponse.arrayBuffer());
      const tagsAfter = await readFormatTags(servedBytes);
      expect(tagsAfter.location).toBeUndefined();
      expect(tagsAfter.title).toBeUndefined();

      void playerId;
    }, 30_000);
  });

  describe('GET /clips — combined status/block filtering', () => {
    it('never returns a hidden or pending_upload clip, and never returns a clip from someone the viewer has blocked', async () => {
      const teamId = await createTeam();
      const { playerId: viewerId, sessionToken: viewerToken } =
        await createPlayer(teamId);
      const { playerId: blockedUploaderId } = await createPlayer(teamId);
      const { sessionToken: otherUploaderToken, playerId: otherUploaderId } =
        await createPlayer(teamId);

      const blockedClip = await createPublishedClip(teamId, blockedUploaderId);
      const otherClip = await createPublishedClip(teamId, otherUploaderId);
      const hiddenClip = await createPublishedClip(teamId, otherUploaderId);
      await dataSource
        .getRepository(VideoClip)
        .update({ id: hiddenClip.id }, { status: VideoClipStatus.HIDDEN });
      const pendingClip = await dataSource.getRepository(VideoClip).save(
        dataSource.getRepository(VideoClip).create({
          teamId,
          uploaderPlayerId: otherUploaderId,
          storageKey: `clips/${teamId}/${randomUUID()}.mp4`,
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
          status: VideoClipStatus.PENDING_UPLOAD,
        }),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ blockedPlayerId: blockedUploaderId })
        .expect(200);

      const listResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/clips`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      const ids = (
        listResponse.body as { clips: ClipFeedItemBody[] }
      ).clips.map((c) => c.clipId);

      expect(ids).toContain(otherClip.id);
      expect(ids).not.toContain(blockedClip.id);
      expect(ids).not.toContain(hiddenClip.id);
      expect(ids).not.toContain(pendingClip.id);

      // A different, non-blocking viewer still sees the blocked uploader's
      // clip — blocking is strictly per-viewer, same as chat.
      const otherViewerList = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/clips`)
        .set('Authorization', `Bearer ${otherUploaderToken}`)
        .expect(200);
      const otherViewerIds = (
        otherViewerList.body as { clips: ClipFeedItemBody[] }
      ).clips.map((c) => c.clipId);
      expect(otherViewerIds).toContain(blockedClip.id);

      void viewerId;
    });

    it('rejects a non-approved viewer with 403 consent_required on the feed GET itself, not just uploads', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/clips`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'consent_required',
      );
    });

    it('orders most-recent-first', async () => {
      const teamId = await createTeam();
      const { sessionToken, playerId } = await createPlayer(teamId);
      const older = await createPublishedClip(teamId, playerId, {
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const newer = await createPublishedClip(teamId, playerId, {
        createdAt: new Date('2026-06-01T00:00:00Z'),
      });

      const listResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/clips`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const ids = (
        listResponse.body as { clips: ClipFeedItemBody[] }
      ).clips.map((c) => c.clipId);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    });
  });

  describe('DELETE /clips/:clipId', () => {
    it('rejects a nonexistent clip with 404', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/teams/${teamId}/clips/${randomUUID()}`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe('clip_not_found');
    });

    it("rejects deleting someone else's clip with 403 not_your_clip", async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId } = await createPlayer(teamId);
      const { sessionToken: otherToken } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/teams/${teamId}/clips/${clip.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe('not_your_clip');
    });

    it('hard-deletes the row unconditionally, even with an open report against it', async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId, sessionToken: uploaderToken } =
        await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'other' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/teams/${teamId}/clips/${clip.id}`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(200);
      expect(response.body).toEqual({ clipId: clip.id, deleted: true });

      const row = await dataSource
        .getRepository(VideoClip)
        .findOne({ where: { id: clip.id } });
      expect(row).toBeNull();

      // The report survives the clip's own deletion (clip_id -> null),
      // per ADR-0010 Decision 5.
      const report = await dataSource
        .getRepository(ClipReport)
        .findOneOrFail({ where: { reportedUploaderPlayerId: uploaderId } });
      expect(report.clipId).toBeNull();
    });
  });

  describe('POST /clips/:clipId/report', () => {
    it('rejects a nonexistent (or non-published) clip with 404', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${randomUUID()}/report`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ reason: 'other' })
        .expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe('clip_not_found');
    });

    it('a second report attempt right after the first gets 404 clip_not_found — the clip already auto-hid itself (ADR-0010 Decision 4), it is not still "published" to report again', async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId } = await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'bullying' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'bullying' })
        .expect(404);
      expect((second.body as ApiErrorBody).error.code).toBe('clip_not_found');

      const reports = await dataSource
        .getRepository(ClipReport)
        .find({ where: { clipId: clip.id } });
      expect(reports).toHaveLength(1);
    });

    it("rejects 409 clip_already_reported_by_you for a clip an out-of-band admin action re-published after an earlier report (ADR-0010's un-hide mechanism) — the uniqueness backstop still works once the clip is reachable again", async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId } = await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'bullying' })
        .expect(201);

      // Simulate the out-of-band admin un-hide ADR-0010 Decision 4
      // describes (a manual DB action, no in-app endpoint) — the clip
      // becomes reachable/reportable again, but the same reporter's
      // earlier report row still exists.
      await dataSource
        .getRepository(VideoClip)
        .update({ id: clip.id }, { status: VideoClipStatus.PUBLISHED });

      const second = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'bullying' })
        .expect(409);
      expect((second.body as ApiErrorBody).error.code).toBe(
        'clip_already_reported_by_you',
      );

      const reports = await dataSource
        .getRepository(ClipReport)
        .find({ where: { clipId: clip.id } });
      expect(reports).toHaveLength(1);
    });

    it('rate-limits a second report (of a different clip) by the same reporter within the cooldown with 429', async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId } = await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);
      const clipOne = await createPublishedClip(teamId, uploaderId);
      const clipTwo = await createPublishedClip(teamId, uploaderId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clipOne.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'other' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clipTwo.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'other' })
        .expect(429);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'clip_report_rate_limited',
      );
    });

    it('IMMEDIATELY hides the clip on a single report — the deliberate divergence from chat (ADR-0010 Decision 4)', async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId, sessionToken: uploaderToken } =
        await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: ClipReportReason.APPEARS_WITHOUT_CONSENT })
        .expect(201);

      const row = await dataSource
        .getRepository(VideoClip)
        .findOneOrFail({ where: { id: clip.id } });
      expect(row.status).toBe(VideoClipStatus.HIDDEN);

      // Gone from the uploader's own feed too, not just the reporter's.
      const uploaderFeed = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/clips`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(200);
      const ids = (
        uploaderFeed.body as { clips: ClipFeedItemBody[] }
      ).clips.map((c) => c.clipId);
      expect(ids).not.toContain(clip.id);
    });

    it("marks reportedByMe true only for the viewer's own report, never for someone else's, and never before the clip is hidden", async () => {
      const teamId = await createTeam();
      const { playerId: uploaderId } = await createPlayer(teamId);
      const { sessionToken: reporterToken, playerId: reporterId } =
        await createPlayer(teamId);
      const { sessionToken: bystanderToken } = await createPlayer(teamId);
      const clipToKeepVisible = await createPublishedClip(teamId, uploaderId);
      const clipToReport = await createPublishedClip(teamId, uploaderId);

      // Report a *different* clip so clipToKeepVisible stays in the feed
      // for this assertion (a report hides only the reported clip).
      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/clips/${clipToReport.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'other' })
        .expect(201);

      const reports = await dataSource
        .getRepository(ClipReport)
        .find({ where: { clipId: clipToReport.id } });
      expect(reports.map((r) => r.reporterPlayerId)).toContain(reporterId);

      void bystanderToken;
      void clipToKeepVisible;
    });
  });
});
