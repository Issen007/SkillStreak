import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { BugReport } from '../src/bug-reports/entities/bug-report.entity';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { STAFF_SESSION_COOKIE_NAME } from '../src/staff-auth/staff-cookies';
import { StaffSessionTokenService } from '../src/staff-auth/staff-session-token.service';
import {
  StaffAccount,
  StaffAccountRole,
  StaffAuthProvider,
} from '../src/staff-auth/entities/staff-account.entity';
import { ADMIN_STEP_UP_FRESHNESS_MS } from '../src/staff-auth/guards/admin-step-up.guard';
import { PLANNING_DOC_FILES } from '../src/admin/admin-planning-docs.service';
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
 * A signed-in admin path was originally left out here, on the grounds that
 * minting a real `staff_session` needs an ADMIN_EMAILS-allow-listed
 * StaffAccount plus ADR-0023's OAuth round trip. Decision 10's step-up gate
 * (added 2026-08-08) forced the issue: "a stale session is refused but a
 * fresh one is not" is precisely a wiring fact, not service logic, so this
 * file now stands up a real allow-listed StaffAccount and signs its own
 * session cookie — skipping only the IdP round trip, which is what
 * staff-auth.service.spec.ts covers.
 */
const ADMIN_EMAIL = 'p7-admin@example.com';

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe('Fas 7: admin console + bug reports (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let inviteCode: string;
  let teamId: string;
  let planningDir: string;
  let staffSessionTokenService: StaffSessionTokenService;
  // Restored in afterAll. Jest reuses worker processes across spec files,
  // so leaving these set would boot every later e2e file in this worker
  // with an admin allow-list and a planning dir pointing at this suite's
  // tmpdir — a failure that would depend on file ordering (code-critic,
  // 2026-08-08).
  let previousAdminEmails: string | undefined;
  let previousPlanningDir: string | undefined;

  beforeAll(async () => {
    // Set before the module compiles, since ConfigService snapshots
    // process.env at construction. ADMIN_EMAILS is normally unset locally,
    // which would make AdminAuthGuard reject every account as not_admin.
    previousAdminEmails = process.env.ADMIN_EMAILS;
    previousPlanningDir = process.env.ADMIN_PLANNING_DOCS_DIR;
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    planningDir = mkdtempSync(join(tmpdir(), 'p7-planning-'));
    process.env.ADMIN_PLANNING_DOCS_DIR = planningDir;
    writeFileSync(
      join(planningDir, PLANNING_DOC_FILES.securityIssues),
      '# Security issues\n- nothing outstanding',
    );

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
    staffSessionTokenService = app.get(StaffSessionTokenService);

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
    await dataSource.getRepository(StaffAccount).delete({ email: ADMIN_EMAIL });
    await app.close();

    // Restore rather than delete: another spec may legitimately have set
    // these before this file ran.
    restoreEnv('ADMIN_EMAILS', previousAdminEmails);
    restoreEnv('ADMIN_PLANNING_DOCS_DIR', previousPlanningDir);
    rmSync(planningDir, { recursive: true, force: true });
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
      ['get', '/api/v1/admin/planning/roadmap'],
      ['get', '/api/v1/admin/planning/ideas'],
      ['get', '/api/v1/admin/planning/security-issues'],
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

  // docs/adr/0022-admin-control-center.md Decision 10. The step-up gate is
  // the only place in this app where a *valid* admin session is refused,
  // so "is AdminStepUpGuard actually on these three routes, and only
  // these three" is exactly the kind of wiring fact a unit test can't
  // reach.
  describe('planning/* — Decision 10 step-up gate', () => {
    /**
     * `stepUpAt` mirrors what a real step-up callback issues: the IdP's
     * verified `auth_time`, in epoch seconds, as a claim on THIS session.
     * Passing undefined models an ordinary /login session — which is the
     * case the gate must refuse, and which the first implementation
     * wrongly accepted because it read an account-wide column every login
     * stamps.
     */
    async function createAdminSession(options: { stepUpAt?: number } = {}) {
      const repository = dataSource.getRepository(StaffAccount);
      const account = await repository.save(
        repository.create({
          email: ADMIN_EMAIL,
          displayName: 'P7 Admin',
          role: StaffAccountRole.ADMIN,
          authProvider: StaffAuthProvider.GOOGLE,
          authProviderSubject: `p7-${randomUUID()}`,
          lastLoginAt: new Date(),
        }),
      );
      const token = staffSessionTokenService.issueFor(
        account.id,
        account.role,
        { stepUpAt: options.stepUpAt },
      );
      return { account, cookie: `${STAFF_SESSION_COOKIE_NAME}=${token}` };
    }

    const secondsAgo = (ms: number) => Math.floor((Date.now() - ms) / 1000);

    afterEach(async () => {
      await dataSource.getRepository(StaffAccount).delete({
        email: ADMIN_EMAIL,
      });
    });

    it('serves a mounted planning doc to a freshly-authenticated admin, with syncedAt', async () => {
      const { cookie } = await createAdminSession({
        stepUpAt: secondsAgo(60_000),
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/planning/security-issues')
        .set('Cookie', cookie)
        .expect(200);

      const body = response.body as {
        sections: Array<{
          source: string;
          content: string;
          available: boolean;
        }>;
        syncedAt: string | null;
      };
      expect(body.sections).toHaveLength(1);
      expect(body.sections[0].available).toBe(true);
      expect(body.sections[0].content).toContain('nothing outstanding');
      expect(body.syncedAt).not.toBeNull();
    });

    // 401 + reauth_required specifically, NOT a plain 401 and NOT a 403:
    // the console renders AD5's inline prompt over preserved state, and a
    // plain 401 means something different (the whole session went).
    it('refuses a stale-but-valid admin session with reauth_required', async () => {
      const { cookie } = await createAdminSession({
        stepUpAt: secondsAgo(ADMIN_STEP_UP_FRESHNESS_MS + 60_000),
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/planning/security-issues')
        .set('Cookie', cookie)
        .expect(401);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'reauth_required',
      );
    });

    // THE bypass a blocking security review found, now a regression test.
    // An ordinary /login issues a session with no step-up claim — and it
    // completes with no credential prompt at all when the IdP's own SSO
    // session is live, which is the whole reason this gate exists. The
    // first implementation accepted it, because it read
    // StaffAccount.lastLoginAt, a column EVERY completed callback stamps.
    it('refuses an ordinary login session even though the account just logged in', async () => {
      const { cookie } = await createAdminSession();

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/planning/security-issues')
        .set('Cookie', cookie)
        .expect(401);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'reauth_required',
      );
    });

    // The gate is scoped to this pillar only — a stale session must keep
    // working everywhere else, or the operator gets bounced out of the
    // whole console instead of one section.
    it('leaves the rest of the console reachable with that same stale session', async () => {
      const { cookie } = await createAdminSession({
        stepUpAt: secondsAgo(ADMIN_STEP_UP_FRESHNESS_MS + 60_000),
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/bug-reports')
        .set('Cookie', cookie)
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/admin/session')
        .set('Cookie', cookie)
        .expect(200);
    });

    // An unmounted key is the normal state on a cluster where the
    // hand-applied ConfigMap doesn't exist yet — an empty section, not a
    // 500 that takes the view down.
    it('reports an unmounted planning key as unavailable rather than failing', async () => {
      const { cookie } = await createAdminSession({
        stepUpAt: secondsAgo(1000),
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/planning/ideas')
        .set('Cookie', cookie)
        .expect(200);

      const body = response.body as {
        sections: Array<{ available: boolean }>;
        syncedAt: string | null;
      };
      expect(body.sections[0].available).toBe(false);
      expect(body.syncedAt).toBeNull();
    });

    // Decision 10: these endpoints accept nothing. main.ts's
    // forbidNonWhitelisted rejects an unlisted parameter outright rather
    // than ignoring it, which is what keeps this pillar from quietly
    // growing a filter.
    it('rejects any query parameter outright', async () => {
      const { cookie } = await createAdminSession({
        stepUpAt: secondsAgo(1000),
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/planning/roadmap?teamId=whatever')
        .set('Cookie', cookie)
        .expect(400);
    });
  });
});
