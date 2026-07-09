import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { ParentalConsentStatus } from '../src/players/player-consent-status.enum';
import { Player } from '../src/players/entities/player.entity';
import { Team } from '../src/teams/entities/team.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';

// supertest types response.body as `any`; these narrow shapes let the
// assertions below use dotted property access without triggering
// @typescript-eslint/no-unsafe-member-access.
interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreatePlayerBody {
  playerId: string;
  teamId: string;
  screenName: string;
  avatarId: string;
  consentStatus: string;
  sessionToken: string;
}

interface TrainingLogBody {
  trainingLogId: string;
  loggedAt: string;
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    alreadyLoggedToday: boolean;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed,
  // and rank is deliberately not added on this hot-path response either.
  teamPool: {
    pointsTotal: number;
  };
}

interface PlayerMeBody {
  player: {
    id: string;
    screenName: string;
    avatarId: string;
    consentStatus: string;
  };
  team: { teamId: string; teamName: string };
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    lastTrainedDate: string | null;
    alreadyLoggedToday: boolean;
  };
  // Fas 2.7 (ADR-0008 Decision 4): goalThreshold/percentComplete removed,
  // rank/teamCount added.
  teamPool: {
    seasonId: string;
    seasonLabel: string;
    pointsTotal: number;
    status: string;
    rank: number;
    teamCount: number;
  };
}

// Exercises the four Phase 1 endpoints end-to-end against a real Postgres +
// Redis (docker-compose's postgres/redis services must be up and migrated —
// see docs/ACTION_PLAN.md's verification steps). Each run
// creates its own Team/Season/TeamSeasonPot fixture (unique invite code) so
// this suite is safe to re-run without colliding with seed data or itself.
describe('Phase 1 API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let inviteCode: string;
  let teamId: string;

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

    inviteCode = `E2E${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'E2E Test Team', inviteCode }),
      );
    teamId = team.id;

    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId,
        label: 'E2E Season',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );

    await dataSource.getRepository(TeamSeasonPot).save(
      dataSource.getRepository(TeamSeasonPot).create({
        teamId,
        seasonId: season.id,
        pointsTotal: 0,
        goalThreshold: 1000,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );
  });

  afterAll(async () => {
    // ON DELETE CASCADE from team removes player/season/pot/etc rows too.
    await dataSource.getRepository(Team).delete({ id: teamId });
    await app.close();
  });

  describe('GET /api/v1/teams/invite/:inviteCode', () => {
    it('returns the team for a valid invite code', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/invite/${inviteCode}`)
        .expect(200);

      expect(response.body).toEqual({ teamId, teamName: 'E2E Test Team' });
    });

    it('returns a generic 404 for an unknown invite code', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/teams/invite/DOES-NOT-EXIST')
        .expect(404);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'invite_code_not_found',
      );
    });
  });

  describe('POST /api/v1/players', () => {
    const screenName = `E2EPlayer${randomUUID().slice(0, 6)}`;

    it('creates the onboarding shell and returns a sessionToken', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/players')
        .send({
          inviteCode,
          screenName,
          avatarId: 'fox',
          birthYear: 2014,
          parentContact: 'parent@example.com',
        })
        .expect(201);

      const body = response.body as CreatePlayerBody;
      expect(body).toMatchObject({
        teamId,
        screenName,
        avatarId: 'fox',
        consentStatus: 'pending',
      });
      expect(typeof body.playerId).toBe('string');
      expect(typeof body.sessionToken).toBe('string');
    });

    it('rejects a duplicate screen name within the same team with 409', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/players')
        .send({
          inviteCode,
          screenName, // same as above, same team
          avatarId: 'wolf',
          birthYear: 2013,
          parentContact: 'other@example.com',
        })
        .expect(409);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'screen_name_taken_in_team',
      );
    });

    it('returns 404 invite_code_not_found for an unknown invite code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/players')
        .send({
          inviteCode: 'DOES-NOT-EXIST',
          screenName: `E2EPlayer${randomUUID().slice(0, 6)}`,
          avatarId: 'fox',
          birthYear: 2014,
          parentContact: 'parent@example.com',
        })
        .expect(404);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'invite_code_not_found',
      );
    });
  });

  describe('Core loop: consent gate, training-logs, players/me', () => {
    let sessionToken: string;
    let playerId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/players')
        .send({
          inviteCode,
          screenName: `E2ECoreLoop${randomUUID().slice(0, 6)}`,
          avatarId: 'fox',
          birthYear: 2014,
          parentContact: 'parent@example.com',
        })
        .expect(201);

      const body = response.body as CreatePlayerBody;
      sessionToken = body.sessionToken;
      playerId = body.playerId;
    });

    it('rejects an unauthenticated training-log POST with 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .send({ activityType: 'fitness', durationMinutes: 15 })
        .expect(401);

      expect((response.body as ApiErrorBody).error.code).toBe('unauthorized');
    });

    it('rejects a training-log POST with 403 consent_required before approval', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ activityType: 'fitness', durationMinutes: 15 })
        .expect(403);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'consent_required',
      );
    });

    it('reflects the pending consent state on GET /players/me', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      const body = response.body as PlayerMeBody;
      expect(body.player.consentStatus).toBe('pending');
      expect(body.streak).toMatchObject({
        currentStreakCount: 0,
        longestStreakCount: 0,
        lastTrainedDate: null,
        alreadyLoggedToday: false,
      });
    });

    it('logs training, updates streak + team pool, and repeats the same-day rule on a second log — once approved (out-of-band, no approval endpoint in this contract)', async () => {
      // Simulates the out-of-band parent-approval surface — there is no
      // POST /consent/:consentToken endpoint in this app's contract.
      await dataSource
        .getRepository(Player)
        .update(
          { id: playerId },
          { parentalConsentStatus: ParentalConsentStatus.APPROVED },
        );

      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ activityType: 'fitness', durationMinutes: 15 })
        .expect(201);
      const first = firstResponse.body as TrainingLogBody;

      expect(first.streak).toEqual({
        currentStreakCount: 1,
        longestStreakCount: 1,
        alreadyLoggedToday: false,
      });
      expect(first.teamPool.pointsTotal).toBe(15);

      const secondResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ activityType: 'drill', durationMinutes: 20 })
        .expect(201);
      const second = secondResponse.body as TrainingLogBody;

      // Same-day-logging rule: streak unchanged, team pool still updates.
      expect(second.streak).toEqual({
        currentStreakCount: 1,
        longestStreakCount: 1,
        alreadyLoggedToday: true,
      });
      expect(second.teamPool.pointsTotal).toBe(35);

      const meResponse = await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const me = meResponse.body as PlayerMeBody;

      expect(me.player.consentStatus).toBe('approved');
      expect(me.streak).toMatchObject({
        currentStreakCount: 1,
        longestStreakCount: 1,
        alreadyLoggedToday: true,
      });
      expect(me.teamPool.pointsTotal).toBe(35);
      // Fas 2.7: the leaderboard is genuinely cross-team/global (by design
      // — ADR-0008), so this suite shares Postgres with every other e2e
      // fixture team ever created; only shape/plausibility is asserted
      // here, not an exact rank/teamCount (see phase2.7-leaderboard.e2e-
      // spec.ts for the real ranking-behavior coverage, which uses its own
      // very-large, well-separated point totals to stay deterministic
      // against that shared state).
      expect(Number.isInteger(me.teamPool.rank)).toBe(true);
      expect(me.teamPool.rank).toBeGreaterThanOrEqual(1);
      expect(me.teamPool.teamCount).toBeGreaterThanOrEqual(1);
      expect(me.teamPool.rank).toBeLessThanOrEqual(me.teamPool.teamCount);
      expect(me.teamPool).not.toHaveProperty('goalThreshold');
      expect(me.teamPool).not.toHaveProperty('percentComplete');
    });
  });
});
