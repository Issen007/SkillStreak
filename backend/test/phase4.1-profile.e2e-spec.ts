import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { Team } from '../src/teams/entities/team.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';
import { PlayerPrivateInfo } from '../src/player-private-info/entities/player-private-info.entity';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreatePlayerBody {
  playerId: string;
  sessionToken: string;
  screenName: string;
}

interface ProfileBody {
  realName: string | null;
  birthYear: number;
  parentContact: string;
  avatarId: string;
}

// docs/adr/0012-profile-page-and-contact-email-change.md. Same real-
// Postgres+Redis posture as phase1.e2e-spec.ts. Players are created via
// the real POST /players endpoint (not a direct repository insert) so
// PlayerPrivateInfo's parent_contact is correctly encrypted the same way
// a live signup would produce, matching the phase2.e2e-spec.ts session-
// reissue tests' own posture.
describe('Phase 4.1: profile page & contact-email change (e2e)', () => {
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

    inviteCode = `P41${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Phase 4.1 Test Team', inviteCode }),
      );
    teamId = team.id;

    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId,
        label: 'Phase 4.1 Season',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );

    await dataSource.getRepository(TeamSeasonPot).save(
      dataSource.getRepository(TeamSeasonPot).create({
        teamId,
        seasonId: season.id,
        pointsTotal: 0,
        goalThreshold: 1_000_000,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Team).delete({ id: teamId });
    await app.close();
  });

  async function createPlayer(parentContact: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/players')
      .send({
        inviteCode,
        screenName: `P41${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2013,
        parentContact,
      })
      .expect(201);
    const body = response.body as CreatePlayerBody;
    return {
      playerId: body.playerId,
      sessionToken: body.sessionToken,
      screenName: body.screenName,
    };
  }

  async function readContactChangeCode(playerId: string): Promise<string> {
    const info = await dataSource
      .getRepository(PlayerPrivateInfo)
      .findOneOrFail({ where: { playerId } });
    expect(info.contactChangeCode).not.toBeNull();
    return info.contactChangeCode as string;
  }

  async function readCancelCode(playerId: string): Promise<string> {
    const info = await dataSource
      .getRepository(PlayerPrivateInfo)
      .findOneOrFail({ where: { playerId } });
    expect(info.contactChangeCancelCode).not.toBeNull();
    return info.contactChangeCancelCode as string;
  }

  // Simulates the 24h grace period having elapsed, without an artificial
  // sleep — same posture as other e2e tests that need to fast-forward a
  // TTL (see phase2.e2e-spec.ts's expiry tests), applied here since the
  // actual apply only happens lazily, on the next read
  // (PlayerPrivateInfoService.getEffective).
  async function backdateApplyAt(playerId: string): Promise<void> {
    await dataSource
      .getRepository(PlayerPrivateInfo)
      .update(
        { playerId },
        { contactChangeApplyAt: new Date(Date.now() - 1000) },
      );
  }

  describe('GET /players/me/profile', () => {
    it('returns realName (null by default), birthYear, parentContact, and avatarId', async () => {
      const { sessionToken } = await createPlayer('profile-get@example.com');

      const response = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body as ProfileBody).toEqual({
        realName: null,
        birthYear: 2013,
        parentContact: 'profile-get@example.com',
        avatarId: 'fox',
      });
    });

    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .expect(401);
    });
  });

  describe('PATCH /players/me/profile', () => {
    it('sets, then clears (explicit null), a real name — never touches birthYear/parentContact', async () => {
      const { sessionToken } = await createPlayer('profile-patch@example.com');

      await request(app.getHttpServer())
        .patch('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ realName: 'Åsa Öberg-Lindqvist' })
        .expect(200);

      const afterSet = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((afterSet.body as ProfileBody).realName).toBe(
        'Åsa Öberg-Lindqvist',
      );
      expect((afterSet.body as ProfileBody).birthYear).toBe(2013);
      expect((afterSet.body as ProfileBody).parentContact).toBe(
        'profile-patch@example.com',
      );

      await request(app.getHttpServer())
        .patch('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ realName: null })
        .expect(200);

      const afterClear = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((afterClear.body as ProfileBody).realName).toBeNull();
    });

    it('changes avatarId — never touches realName/birthYear/parentContact', async () => {
      const { sessionToken } = await createPlayer(
        'profile-patch-avatar@example.com',
      );

      await request(app.getHttpServer())
        .patch('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ avatarId: 'wolf' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((after.body as ProfileBody).avatarId).toBe('wolf');
      expect((after.body as ProfileBody).realName).toBeNull();
      expect((after.body as ProfileBody).birthYear).toBe(2013);
      expect((after.body as ProfileBody).parentContact).toBe(
        'profile-patch-avatar@example.com',
      );
    });

    it('rejects an empty-string avatarId (whitelist validation)', async () => {
      const { sessionToken } = await createPlayer(
        'profile-patch-avatar-empty@example.com',
      );
      await request(app.getHttpServer())
        .patch('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ avatarId: '' })
        .expect(400);
    });

    it('rejects birthYear in the request body (whitelist validation, no update path exists)', async () => {
      const { sessionToken } = await createPlayer(
        'profile-patch-2@example.com',
      );
      await request(app.getHttpServer())
        .patch('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ birthYear: 1999 })
        .expect(400);
    });
  });

  describe('Contact-email change (request + confirm)', () => {
    // security-reviewer finding, 2026-07-28 (ADR-0012 addendum): confirm no
    // longer applies the change immediately. These tests assert the grace-
    // period behavior — see the "grace period, cancel link, lazy apply"
    // describe block below for the cancel/apply-on-read paths.
    it('never returns the code, starts a grace period on confirm (does not apply immediately), and rejects the code a second time', async () => {
      const { playerId, sessionToken } = await createPlayer(
        'contact-change-old@example.com',
      );

      const requestResponse = await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ newContact: 'contact-change-new@example.com' })
        .expect(200);
      expect(requestResponse.body).toEqual({
        requested: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        expiresAt: expect.any(String),
      });
      expect(JSON.stringify(requestResponse.body)).not.toMatch(/[0-9A-Z]{8}/);

      // Not applied yet — still the old contact.
      const beforeConfirm = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((beforeConfirm.body as ProfileBody).parentContact).toBe(
        'contact-change-old@example.com',
      );

      const code = await readContactChangeCode(playerId);
      const confirmResponse = await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-confirm')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code })
        .expect(200);
      expect(confirmResponse.body).toEqual({
        confirmed: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        appliesAt: expect.any(String),
      });
      expect(JSON.stringify(confirmResponse.body)).not.toMatch(/[0-9A-Z]{8}/);

      // Still not applied — the grace period hasn't elapsed yet.
      const afterConfirm = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((afterConfirm.body as ProfileBody).parentContact).toBe(
        'contact-change-old@example.com',
      );

      // Single-use: the same new-address code can't be redeemed again.
      const secondAttempt = await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-confirm')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code })
        .expect(400);
      expect((secondAttempt.body as ApiErrorBody).error.code).toBe(
        'invalid_or_expired_contact_change_code',
      );
    });

    it('rejects a second change-request within the cooldown window with 429', async () => {
      const { sessionToken } = await createPlayer(
        'contact-change-cooldown@example.com',
      );

      await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ newContact: 'first-attempt@example.com' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ newContact: 'second-attempt@example.com' })
        .expect(429);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'contact_change_rate_limited',
      );
    });

    it('rejects an unknown confirmation code with the generic error', async () => {
      const { sessionToken } = await createPlayer(
        'contact-change-badcode@example.com',
      );
      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-confirm')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code: 'NOSUCHCO' })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'invalid_or_expired_contact_change_code',
      );
    });

    it("rejects confirming with another player's own valid code (cross-account defense in depth)", async () => {
      const playerA = await createPlayer('cross-account-a@example.com');
      const playerB = await createPlayer('cross-account-b@example.com');

      await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-request')
        .set('Authorization', `Bearer ${playerA.sessionToken}`)
        .send({ newContact: 'cross-account-a-new@example.com' })
        .expect(200);
      const codeForA = await readContactChangeCode(playerA.playerId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-confirm')
        .set('Authorization', `Bearer ${playerB.sessionToken}`)
        .send({ code: codeForA })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'invalid_or_expired_contact_change_code',
      );
    });
  });

  // security-reviewer finding, 2026-07-28 (ADR-0012 addendum): a live
  // session with no password/step-up auth could otherwise redirect
  // parent_contact in two quick calls. These tests exercise the 24h grace
  // period, the OLD address's cancel link (a GET/POST web page, not an app
  // screen — reachable without a session at all), and the lazy apply-on-
  // read once the grace period has elapsed.
  describe('Contact-email change: grace period, cancel link, lazy apply', () => {
    async function requestAndConfirm(
      playerId: string,
      sessionToken: string,
      newContact: string,
    ): Promise<string> {
      await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ newContact })
        .expect(200);
      const code = await readContactChangeCode(playerId);
      await request(app.getHttpServer())
        .post('/api/v1/players/me/contact-change-confirm')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ code })
        .expect(200);
      return readCancelCode(playerId);
    }

    it('GET on the cancel link previews without side effects; a bogus code renders the invalid page', async () => {
      const { playerId, sessionToken, screenName } = await createPlayer(
        'grace-preview-old@example.com',
      );
      const cancelCode = await requestAndConfirm(
        playerId,
        sessionToken,
        'grace-preview-new@example.com',
      );

      const validPreview = await request(app.getHttpServer())
        .get(`/api/v1/players/contact-change-cancel/${cancelCode}`)
        .expect(200);
      expect(validPreview.text).toContain(screenName);
      expect(validPreview.text).toContain('Avbryt bytet');

      // GET has no side effects — the change is still pending afterwards.
      const info = await dataSource
        .getRepository(PlayerPrivateInfo)
        .findOneOrFail({ where: { playerId } });
      expect(info.contactChangeCancelCode).toBe(cancelCode);

      const invalidPreview = await request(app.getHttpServer())
        .get('/api/v1/players/contact-change-cancel/NOSUCHCODE')
        .expect(200);
      expect(invalidPreview.text).toContain('Länken fungerar inte längre');
    });

    it('POST on the cancel link reverts the pending change and invalidates the current session', async () => {
      const { playerId, sessionToken } = await createPlayer(
        'grace-cancel-old@example.com',
      );
      const cancelCode = await requestAndConfirm(
        playerId,
        sessionToken,
        'grace-cancel-new@example.com',
      );

      const cancelResponse = await request(app.getHttpServer())
        .post(`/api/v1/players/contact-change-cancel/${cancelCode}`)
        .expect(200);
      expect(cancelResponse.text).toContain('Avbrutet');

      // The pending change is gone.
      const info = await dataSource
        .getRepository(PlayerPrivateInfo)
        .findOneOrFail({ where: { playerId } });
      expect(info.pendingParentContact).toBeNull();
      expect(info.contactChangeApplyAt).toBeNull();
      expect(info.contactChangeCancelCode).toBeNull();

      // The session live at cancel time is now stale (token_version bump).
      await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);

      // A second POST to the same (now-consumed) code is a friendly no-op,
      // not an error — same idiom as the parental-consent approval page.
      const secondPost = await request(app.getHttpServer())
        .post(`/api/v1/players/contact-change-cancel/${cancelCode}`)
        .expect(200);
      expect(secondPost.text).toContain('Länken fungerar inte längre');
    });

    it('applies the change lazily on the next read, once the grace period has elapsed', async () => {
      const { playerId, sessionToken } = await createPlayer(
        'grace-apply-old@example.com',
      );
      await requestAndConfirm(
        playerId,
        sessionToken,
        'grace-apply-new@example.com',
      );

      // Still within the grace period — unchanged.
      const stillPending = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((stillPending.body as ProfileBody).parentContact).toBe(
        'grace-apply-old@example.com',
      );

      await backdateApplyAt(playerId);

      const afterElapsed = await request(app.getHttpServer())
        .get('/api/v1/players/me/profile')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((afterElapsed.body as ProfileBody).parentContact).toBe(
        'grace-apply-new@example.com',
      );

      // The pending/cancel state is cleared once applied — the cancel link
      // no longer does anything (there's nothing left to cancel).
      const info = await dataSource
        .getRepository(PlayerPrivateInfo)
        .findOneOrFail({ where: { playerId } });
      expect(info.pendingParentContact).toBeNull();
      expect(info.contactChangeApplyAt).toBeNull();
      expect(info.contactChangeCancelCode).toBeNull();
    });
  });
});
