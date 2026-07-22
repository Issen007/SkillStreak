import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { PlayerTokenService } from '../src/auth/player-token.service';
import { Player } from '../src/players/entities/player.entity';
import { PlayerPrivateInfo } from '../src/player-private-info/entities/player-private-info.entity';
import { Team } from '../src/teams/entities/team.entity';
import { ParentalConsentStatus } from '../src/players/player-consent-status.enum';
import { ClipReport } from '../src/video-clips/entities/clip-report.entity';
import {
  VideoClip,
  VideoClipStatus,
} from '../src/video-clips/entities/video-clip.entity';

// The race-prone path in VideoClipsService.reportClip: the "already
// reported by you" pre-check (a plain findOne) and the insert both read/
// write clip_report without a row lock — two near-simultaneous report
// requests from the *same* reporter against the *same* clip could both
// pass the pre-check before either has inserted. Mirrors this codebase's
// existing concurrency-test convention (captain-transfer-concurrency.e2e-
// spec.ts, self-service-team-creation-concurrency.e2e-spec.ts) — fire
// genuinely concurrent requests (Promise.all, not sequential awaits) and
// assert the *outcome* invariant (at most one ClipReport row, at most one
// 201) holds regardless of which request actually won the race.
describe('Fas 3: concurrent clip reports from the same reporter (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let playerTokenService: PlayerTokenService;

  beforeAll(async () => {
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
    const inviteCode = `CLIPC${randomUUID().slice(0, 7).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Team Clip Concurrency Test', inviteCode }),
      );
    return team.id;
  }

  async function createPlayer(teamId: string) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Clip${randomUUID().slice(0, 8)}`,
        avatarId: 'fox',
        birthYear: 2013,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
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

  async function createPublishedClip(teamId: string, uploaderPlayerId: string) {
    return dataSource.getRepository(VideoClip).save(
      dataSource.getRepository(VideoClip).create({
        teamId,
        uploaderPlayerId,
        storageKey: `clips/${teamId}/${randomUUID()}.mp4`,
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
        status: VideoClipStatus.PUBLISHED,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }),
    );
  }

  it('exactly one of N concurrent identical report requests succeeds; the rest fail, never a second row', async () => {
    const teamId = await createTeam();
    const { playerId: uploaderId } = await createPlayer(teamId);
    const { sessionToken: reporterToken } = await createPlayer(teamId);
    const clip = await createPublishedClip(teamId, uploaderId);

    const CONCURRENT_REQUESTS = 8;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/teams/${teamId}/clips/${clip.id}/report`)
          .set('Authorization', `Bearer ${reporterToken}`)
          .send({ reason: 'other' }),
      ),
    );

    const statuses = results.map((r) => r.status);
    const successes = statuses.filter((s) => s === 201);
    // Every non-winning request rejects with one of three codes, all
    // correct depending on exactly when its own reads landed relative to
    // the winner's insert + immediate auto-hide (ADR-0010 Decision 4):
    // 409 (it saw the report row already there), 429 (the atomic Redis
    // cooldown claim lost the race), or 404 (its own "clip is still
    // published" read ran *after* the winner's auto-hide already committed
    // — the same "someone else's report already hid it" race the contract
    // itself documents for endpoint 5). Any other status would be a real
    // bug (e.g. an uncaught unique-violation surfacing as a 500).
    const rejections = statuses.filter(
      (s) => s === 409 || s === 429 || s === 404,
    );

    expect(successes).toHaveLength(1);
    expect(successes.length + rejections.length).toBe(CONCURRENT_REQUESTS);

    const reports = await dataSource
      .getRepository(ClipReport)
      .find({ where: { clipId: clip.id } });
    expect(reports).toHaveLength(1);

    // The clip is hidden exactly once (idempotent even if it somehow got
    // updated twice — the important invariant is the row count above).
    const row = await dataSource
      .getRepository(VideoClip)
      .findOneOrFail({ where: { id: clip.id } });
    expect(row.status).toBe(VideoClipStatus.HIDDEN);
  }, 30_000);
});
