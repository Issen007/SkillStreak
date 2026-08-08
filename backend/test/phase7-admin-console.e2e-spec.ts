import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { BugReport } from '../src/bug-reports/entities/bug-report.entity';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { STAFF_SESSION_COOKIE_NAME } from '../src/staff-auth/staff-cookies';
import { Team } from '../src/teams/entities/team.entity';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreatePlayerBody {
  playerId: string;
  sessionToken: string;
  screenName: string;
}

/**
 * docs/adr/0022-admin-control-center.md Decisions 4/6/7 (Fas 7 backend).
 *
 * Two things this file is actually for:
 *
 *  1. **Every `/api/v1/admin/*` route is unreachable without a valid staff
 *     session.** That's the whole security posture of this feature —
 *     Decision 3 deliberately keeps the admin surface *public + authenticated*
 *     rather than VPN-isolated, on the argument that "the residual risk is
 *     bounded at the data layer, not the network layer". Which makes
 *     "AdminAuthGuard is definitely on every one of these routes" the single
 *     assumption that argument rests on, and therefore worth an actual test
 *     rather than a class-level decorator nobody re-reads.
 *  2. **The player-facing submission works end to end against real Postgres
 *     and real Redis**, including the enum columns the 2026-08-02
 *     security-reviewer correction insisted on and the `bug_report_rate_limited`
 *     limiter §13 names by code.
 *
 * A signed-in admin path is deliberately *not* exercised here: minting a
 * real `staff_session` needs an ADMIN_EMAILS-allow-listed StaffAccount plus
 * ADR-0023's OAuth round trip, and the read services' own logic is covered
 * by unit specs (admin-*.service.spec.ts). What can't be unit-tested — "is
 * the guard actually wired to these paths" — is what's here.
 */
describe('Fas 7: admin console + bug reports (e2e)', () => {
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
    // Matches main.ts — StaffAuthGuard reads `request.cookies`, so without
    // this the "garbage cookie" case below would pass for the wrong reason
    // (no parsed cookies at all rather than an unverifiable one).
    app.use(cookieParser());
    await app.init();

    dataSource = app.get(DataSource);

    inviteCode = `P7A${randomUUID().slice(0, 8).toUpperCase()}`;
    const teamRepository = dataSource.getRepository(Team);
    const team = await teamRepository.save(
      teamRepository.create({ name: 'Phase 7 Test Team', inviteCode }),
    );
    teamId = team.id;
  });

  afterAll(async () => {
    // bug_report.player_id is ON DELETE CASCADE and player.team_id cascades
    // from the team, so deleting the team removes this suite's rows the same
    // way a real account erasure would.
    await dataSource.getRepository(Team).delete({ id: teamId });
    await app.close();
  });

  async function createPlayer(): Promise<CreatePlayerBody> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/players')
      .send({
        inviteCode,
        screenName: `P7${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2013,
        parentContact: `p7-${randomUUID().slice(0, 8)}@example.com`,
      })
      .expect(201);
    return response.body as CreatePlayerBody;
  }

  function validSubmission(overrides: Record<string, unknown> = {}) {
    return {
      category: 'upload_failed',
      screen: 'clip_upload',
      description: 'jag tryckte på ladda upp och sen hände inget',
      appVersion: '1.4.2',
      platform: 'ios',
      osVersion: 'iOS 17.5.1',
      locale: 'sv',
      ...overrides,
    };
  }

  describe('every admin route requires a staff session', () => {
    const routes: Array<[string, string]> = [
      ['get', '/api/v1/admin/session'],
      ['get', '/api/v1/admin/usage-metrics'],
      ['get', '/api/v1/admin/errors'],
      ['get', '/api/v1/admin/bug-reports'],
    ];

    it.each(routes)(
      '%s %s returns 401 with no cookie',
      async (_method, path) => {
        const response = await request(app.getHttpServer())
          .get(path)
          .expect(401);

        expect((response.body as ApiErrorBody).error.code).toBe(
          'staff_unauthorized',
        );
      },
    );

    it.each(routes)(
      '%s %s returns 401 with an unverifiable staff_session cookie',
      async (_method, path) => {
        await request(app.getHttpServer())
          .get(path)
          .set('Cookie', `${STAFF_SESSION_COOKIE_NAME}=not-a-real-jwt`)
          .expect(401);
      },
    );

    // The guard must run before body validation — otherwise an unauthenticated
    // caller could probe the DTO's shape by watching 400s vs 401s.
    it('PATCH /api/v1/admin/bug-reports/:id returns 401 before validating the body', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/admin/bug-reports/${randomUUID()}`)
        .send({ status: 'not-a-status', note: 'freeform' })
        .expect(401);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'staff_unauthorized',
      );
    });

    // A player's own bearer token is a wholly separate credential universe
    // (STAFF_JWT_SECRET vs JWT_SECRET — ADR-0023 Decision B2 reusing ADR-0004
    // Part 2's reasoning), so it must not open an admin route even by
    // accident.
    it('rejects a valid PLAYER session token on an admin route', async () => {
      const player = await createPlayer();

      await request(app.getHttpServer())
        .get('/api/v1/admin/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .expect(401);
    });
  });

  describe('POST /api/v1/bug-reports', () => {
    it('requires a player session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .send(validSubmission())
        .expect(401);
    });

    it('stores exactly the allow-listed fields, status open', async () => {
      const player = await createPlayer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send(validSubmission())
        .expect(201);

      const body = response.body as { id: string; createdAt: string };
      const stored = await dataSource
        .getRepository(BugReport)
        .findOneOrFail({ where: { id: body.id } });

      expect(stored).toMatchObject({
        playerId: player.playerId,
        category: 'upload_failed',
        screen: 'clip_upload',
        platform: 'ios',
        appVersion: '1.4.2',
        osVersion: 'iOS 17.5.1',
        locale: 'sv',
        status: 'open',
      });
    });

    // §9.3's exact enum, enforced by the real Postgres type — `roster` is in
    // ADR-0022 Decision 7's illustrative list but was deliberately folded
    // into `team`, so it must be refused rather than stored.
    it('rejects a screen value outside §9.3’s ten', async () => {
      const player = await createPlayer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send(validSubmission({ screen: 'roster' }))
        .expect(400);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    // CLAUDE.md's non-negotiable, at the boundary: the DTO has no location
    // field, and forbidNonWhitelisted turns that into a 400 rather than a
    // silent drop.
    it('rejects a location field outright', async () => {
      const player = await createPlayer();

      await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send(validSubmission({ latitude: 59.33, longitude: 18.06 }))
        .expect(400);
    });

    // The real Redis burst cooldown (RedisService.tryClaimBugReportCooldown),
    // with the error code docs/design/phase7-admin-console-flows.md §13
    // specifies by name.
    it('rate-limits a second immediate submission as bug_report_rate_limited', async () => {
      const player = await createPlayer();

      await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send(validSubmission())
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send(validSubmission({ category: 'crash', screen: 'home' }))
        .expect(429);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'bug_report_rate_limited',
      );
    });

    // §9.1/Decision 7: the endpoint is deliberately NOT consent-gated. A
    // freshly created player is `pending` parental consent, and this call
    // must still succeed — that's the whole point.
    it('accepts a submission from a player whose parental consent is still pending', async () => {
      const player = await createPlayer();

      await request(app.getHttpServer())
        .post('/api/v1/bug-reports')
        .set('Authorization', `Bearer ${player.sessionToken}`)
        .send(validSubmission({ description: undefined, osVersion: undefined }))
        .expect(201);
    });
  });
});
