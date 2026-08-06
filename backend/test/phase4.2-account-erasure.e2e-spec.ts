import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { AccountErasureSweepService } from '../src/account-erasure/account-erasure-sweep.service';
import {
  AccountErasureRequest,
  AccountErasureStatus,
} from '../src/account-erasure/entities/account-erasure-request.entity';
import { PlayerTokenService } from '../src/auth/player-token.service';
import { RedisService } from '../src/redis/redis.service';
import {
  Challenge,
  ChallengeStatus,
} from '../src/challenges/entities/challenge.entity';
import { ParentalConsentStatus } from '../src/players/player-consent-status.enum';
import { TeamJoinStatus } from '../src/players/team-join-status.enum';
import { Player } from '../src/players/entities/player.entity';
import { PlayerPrivateInfo } from '../src/player-private-info/entities/player-private-info.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';
import { TeamChatMessage } from '../src/team-chat/entities/team-chat-message.entity';
import { Team } from '../src/teams/entities/team.entity';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface RequestErasureBody {
  requested: true;
  expiresAt: string;
}

interface ErasureStatusBody {
  status: 'none' | 'requested' | 'grace_period';
  scheduledFor?: string;
}

// docs/adr/0013-account-erasure.md. Same real-Postgres+Redis posture as
// phase2.6a-captain-transfer.e2e-spec.ts, whose fixture-creation
// conventions this mirrors exactly (a fresh Team/Season/TeamSeasonPot +
// directly-created players per test, bypassing the throttled
// POST /players onboarding endpoint — this feature's own gates don't
// depend on a real PlayerPrivateInfo row existing, and the confirm/cancel
// codes are read straight off the AccountErasureRequest row, the same way
// phase4.1's readContactChangeCode reads PlayerPrivateInfo directly,
// rather than parsing a real sent email).
describe('Fas 4 (ADR-0013): self-service GDPR account erasure (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let playerTokenService: PlayerTokenService;
  let sweepService: AccountErasureSweepService;
  let redisService: RedisService;

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
    sweepService = app.get(AccountErasureSweepService);
    redisService = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  // sweepService.sweep() is called directly and repeatedly across this
  // file's `it()` blocks, all within the same app instance/Redis
  // connection — without this, AccountErasureSweepService's production
  // cross-replica try-lock (ce84e0b) would let only the *first* sweep()
  // call in this whole file actually run, since the lock's real TTL
  // (5 minutes) far outlasts a single test and the global Redis flush only
  // runs once for the entire e2e suite (see redis-flush.global-setup.js).
  // Resetting just this one key (not a full flush) leaves other Redis
  // state — rate-limit cooldowns, leaderboards — that other tests in this
  // file may still depend on untouched.
  beforeEach(async () => {
    await redisService.deleteScheduledJobRunLock('account-erasure:sweep');
  });

  async function createTeamFixture() {
    const inviteCode = `AE${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Account Erasure Test Team', inviteCode }),
      );
    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId: team.id,
        label: 'AE Season',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );
    await dataSource.getRepository(TeamSeasonPot).save(
      dataSource.getRepository(TeamSeasonPot).create({
        teamId: team.id,
        seasonId: season.id,
        pointsTotal: 0,
        goalThreshold: 1_000_000,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );
    return { teamId: team.id };
  }

  async function createPlayer(
    teamId: string,
    options: {
      isCaptain?: boolean;
      parentalConsentStatus?: ParentalConsentStatus;
    } = {},
  ) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `AE${randomUUID().slice(0, 8)}`,
        avatarId: 'fox',
        birthYear: 2013,
        parentalConsentStatus:
          options.parentalConsentStatus ?? ParentalConsentStatus.APPROVED,
        teamJoinStatus: TeamJoinStatus.APPROVED,
        isCaptain: options.isCaptain ?? false,
      }),
    );
    const sessionToken = playerTokenService.issueFor(
      player.id,
      player.tokenVersion,
    );
    return { playerId: player.id, sessionToken };
  }

  /** Gives a player a real parent_contact — needed only for the handful of
   * tests that exercise the pending-contact-change gate (Decision 2),
   * which reads/writes PlayerPrivateInfo directly. */
  async function givePlayerPrivateInfo(
    playerId: string,
    fields: { parentContact: string; pendingParentContact?: string },
  ) {
    await dataSource.getRepository(PlayerPrivateInfo).save(
      dataSource.getRepository(PlayerPrivateInfo).create({
        playerId,
        parentContact: fields.parentContact,
        pendingParentContact: fields.pendingParentContact ?? null,
        contactChangeApplyAt: fields.pendingParentContact
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : null,
      }),
    );
  }

  async function readErasureRow(playerId: string) {
    return dataSource.getRepository(AccountErasureRequest).findOneOrFail({
      where: {
        playerId,
        status: In([
          AccountErasureStatus.REQUESTED,
          AccountErasureStatus.GRACE_PERIOD,
        ]),
      },
    });
  }

  async function requestErasure(
    sessionToken: string,
    successorPlayerId?: string,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/players/me/erasure/request')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send(successorPlayerId ? { successorPlayerId } : {})
      .expect(201);
    return response.body as RequestErasureBody;
  }

  async function confirmErasure(playerId: string) {
    const row = await readErasureRow(playerId);
    const code = row.confirmCode as string;
    await request(app.getHttpServer())
      .get(`/api/v1/players/erasure-confirm/${code}`)
      .expect(200);
    const confirmResponse = await request(app.getHttpServer())
      .post(`/api/v1/players/erasure-confirm/${code}`)
      .expect(200);
    return confirmResponse.text;
  }

  /** Simulates the 30-day grace period having elapsed, without an
   * artificial sleep — same posture as phase4.1's backdateApplyAt. */
  async function backdateScheduledFor(playerId: string) {
    await dataSource
      .getRepository(AccountErasureRequest)
      .update(
        { playerId, status: AccountErasureStatus.GRACE_PERIOD },
        { scheduledFor: new Date(Date.now() - 1000) },
      );
  }

  describe('request -> confirm -> cancel (in-app, primary path)', () => {
    it('walks the full status lifecycle: none -> requested -> grace_period -> none', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId, sessionToken } = await createPlayer(teamId);
      await createPlayer(teamId); // a teammate, so the team survives

      const before = await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect(before.body as ErasureStatusBody).toEqual({ status: 'none' });

      const requested = await requestErasure(sessionToken);
      expect(requested.requested).toBe(true);
      expect(JSON.stringify(requested)).not.toMatch(/[0-9A-Z]{8}/);

      const afterRequest = await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((afterRequest.body as ErasureStatusBody).status).toBe('requested');

      const confirmedHtml = await confirmErasure(playerId);
      expect(confirmedHtml).toContain('Bekräftat');

      const afterConfirm = await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const statusBody = afterConfirm.body as ErasureStatusBody;
      expect(statusBody.status).toBe('grace_period');
      expect(typeof statusBody.scheduledFor).toBe('string');

      // The account stays fully live during the grace period (Decision 7)
      // — the in-app cancel button works, no token_version bump.
      const cancelResponse = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/cancel')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect(cancelResponse.body).toEqual({ cancelled: true });

      const afterCancel = await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      expect((afterCancel.body as ErasureStatusBody).status).toBe('none');

      // Still a fully live session — cancelling never bumps token_version
      // (Decision 7's deliberate asymmetry with ADR-0012's cancel).
      await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
    });

    it('POST /me/erasure/cancel returns 409 erasure_request_not_active when nothing is pending', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/cancel')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'erasure_request_not_active',
      );
    });
  });

  describe('request -> confirm -> cancel (mailed link, backup path)', () => {
    it('GET previews without side effects; POST cancels and is idempotent on a second POST', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId, sessionToken } = await createPlayer(teamId);
      await createPlayer(teamId);

      await requestErasure(sessionToken);
      await confirmErasure(playerId);
      const row = await readErasureRow(playerId);
      const cancelCode = row.cancelCode as string;

      const preview = await request(app.getHttpServer())
        .get(`/api/v1/players/erasure-cancel/${cancelCode}`)
        .expect(200);
      expect(preview.text).toContain('Avbryt radering');

      // GET has no side effects.
      const stillGracePeriod = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { id: row.id } });
      expect(stillGracePeriod.status).toBe(AccountErasureStatus.GRACE_PERIOD);

      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/players/erasure-cancel/${cancelCode}`)
        .expect(200);
      expect(cancelled.text).toContain('Avbrutet');

      const afterCancel = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { id: row.id } });
      expect(afterCancel.status).toBe(AccountErasureStatus.CANCELLED);
      expect(afterCancel.cancelCode).toBeNull();

      // A second POST to the already-consumed code is a friendly no-op.
      const secondPost = await request(app.getHttpServer())
        .post(`/api/v1/players/erasure-cancel/${cancelCode}`)
        .expect(200);
      expect(secondPost.text).toContain('Länken fungerar inte längre');

      // Session is still fully live (no token_version bump either way).
      await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
    });

    it('GET/POST on a bogus code renders the invalid-link page, not a JSON error', async () => {
      const invalidPreview = await request(app.getHttpServer())
        .get('/api/v1/players/erasure-cancel/NOSUCHCODE')
        .expect(200);
      expect(invalidPreview.text).toContain('Länken fungerar inte längre');

      const invalidConfirmPreview = await request(app.getHttpServer())
        .get('/api/v1/players/erasure-confirm/NOSUCHCODE')
        .expect(200);
      expect(invalidConfirmPreview.text).toContain(
        'Länken fungerar inte längre',
      );
    });
  });

  describe('successorPlayerId validation (Decision 4)', () => {
    it('requires successorPlayerId for a captain with >=1 teammate — 409 erasure_successor_required', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken } = await createPlayer(teamId, { isCaptain: true });
      await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({})
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'erasure_successor_required',
      );
    });

    it('forbids successorPlayerId for a non-captain — 409 erasure_successor_not_allowed', async () => {
      const { teamId } = await createTeamFixture();
      await createPlayer(teamId, { isCaptain: true });
      const { sessionToken } = await createPlayer(teamId);
      const { playerId: otherId } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ successorPlayerId: otherId })
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'erasure_successor_not_allowed',
      );
    });

    it('rejects a successorPlayerId that does not belong to the same team — 409 erasure_successor_invalid', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken } = await createPlayer(teamId, { isCaptain: true });
      await createPlayer(teamId);
      const { teamId: otherTeamId } = await createTeamFixture();
      const { playerId: outsiderId } = await createPlayer(otherTeamId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ successorPlayerId: outsiderId })
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'erasure_successor_invalid',
      );
    });
  });

  describe('the pending-contact-change gate (Decision 2)', () => {
    it('refuses with 409 erasure_blocked_pending_contact_change while a contact change is unresolved', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId, sessionToken } = await createPlayer(teamId);
      await createPlayer(teamId);
      await givePlayerPrivateInfo(playerId, {
        parentContact: 'parent@example.com',
        pendingParentContact: 'attacker@example.com',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({})
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'erasure_blocked_pending_contact_change',
      );
    });
  });

  describe('rate limiting (Decision 3)', () => {
    it('rejects a second request within the burst-cooldown window with 429 erasure_rate_limited', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken } = await createPlayer(teamId);
      await createPlayer(teamId);

      await requestErasure(sessionToken);

      const response = await request(app.getHttpServer())
        .post('/api/v1/players/me/erasure/request')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({})
        .expect(429);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'erasure_rate_limited',
      );
    });
  });

  describe('request -> confirm -> execute (scheduled sweep, non-last-player case)', () => {
    it('hard-deletes the player, anonymizes their chat messages, and nulls their weekly-goal authorship — the team continues', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId, sessionToken } = await createPlayer(teamId);
      const { playerId: teammateId } = await createPlayer(teamId);

      const message = await dataSource.getRepository(TeamChatMessage).save(
        dataSource.getRepository(TeamChatMessage).create({
          teamId,
          senderPlayerId: playerId,
          content: 'hej laget!',
        }),
      );
      const challenge = await dataSource.getRepository(Challenge).save(
        dataSource.getRepository(Challenge).create({
          teamId,
          createdByPlayerId: playerId,
          title: 'Veckans mål',
          description: '10 pass',
          targetMetric: 'sessions',
          targetValue: 10,
          startDate: '2026-01-01',
          endDate: '2026-01-07',
          status: ChallengeStatus.ACTIVE,
        }),
      );

      await requestErasure(sessionToken);
      await confirmErasure(playerId);
      await backdateScheduledFor(playerId);

      await sweepService.sweep();

      // The player row (and, cascading, PlayerPrivateInfo) is gone.
      const playerRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: playerId } });
      expect(playerRow).toBeNull();

      // The session token minted for this now-deleted player is dead —
      // JwtAuthGuard's live lookup treats "no such player" as invalid
      // (Decision 6's "Session validity" note).
      await request(app.getHttpServer())
        .get('/api/v1/players/me/erasure/status')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);

      // The chat message survives, anonymized (Decision 6).
      const messageRow = await dataSource
        .getRepository(TeamChatMessage)
        .findOneOrFail({ where: { id: message.id } });
      expect(messageRow.senderPlayerId).toBeNull();
      expect(messageRow.content).toBe(
        '[Det här meddelandet är borttaget – kontot har raderats]',
      );

      // The weekly goal survives, its authorship detached (Decision 6).
      const challengeRow = await dataSource
        .getRepository(Challenge)
        .findOneOrFail({ where: { id: challenge.id } });
      expect(challengeRow.createdByPlayerId).toBeNull();

      // The erasure request itself is now the durable audit trail.
      const erasureRow = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { playerId } });
      expect(erasureRow.status).toBe(AccountErasureStatus.EXECUTED);
      expect(erasureRow.executedAt).not.toBeNull();

      // The team itself, and the surviving teammate, are untouched.
      const teamRow = await dataSource
        .getRepository(Team)
        .findOne({ where: { id: teamId } });
      expect(teamRow).not.toBeNull();
      const teammateRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: teammateId } });
      expect(teammateRow).not.toBeNull();
    });
  });

  describe('request -> confirm -> execute — deferred captain flip (Decision 4)', () => {
    it('applies the named successor only at execution time, not at confirm time', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createPlayer(teamId, { isCaptain: true });
      const { playerId: successorId } = await createPlayer(teamId);

      await requestErasure(captainToken, successorId);
      await confirmErasure(captainId);

      // Not applied yet — the captain keeps their flag for the whole
      // grace period (Decision 4/7).
      const beforeExecution = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: captainId } });
      expect(beforeExecution.isCaptain).toBe(true);
      const successorBefore = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: successorId } });
      expect(successorBefore.isCaptain).toBe(false);

      await backdateScheduledFor(captainId);
      await sweepService.sweep();

      const successorAfter = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: successorId } });
      expect(successorAfter.isCaptain).toBe(true);
      const captainRowAfter = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: captainId } });
      expect(captainRowAfter).toBeNull();
    });

    it("applies the deferred handoff even though the departing captain's own consent is still PENDING — the code-critic-confirmed bug fix (2026-07-29)", async () => {
      // ADR-0009: a self-created team's founding captain can exist with
      // parentalConsentStatus still pending. Before this fix, the sweep's
      // captain-flip call went through PlayersService.transferCaptaincy,
      // which requires the *requester's* own consent to be approved —
      // wrongly, for this call site (see
      // PlayersService.applyDeferredCaptainHandoff's own comment) — so
      // this exact scenario used to throw CaptainConsentRequiredException
      // every night, forever, and the erasure never completed.
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createPlayer(teamId, {
          isCaptain: true,
          parentalConsentStatus: ParentalConsentStatus.PENDING,
        });
      const { playerId: successorId } = await createPlayer(teamId);

      await requestErasure(captainToken, successorId);
      await confirmErasure(captainId);
      await backdateScheduledFor(captainId);

      await sweepService.sweep();

      const successorAfter = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: successorId } });
      expect(successorAfter.isCaptain).toBe(true);
      const captainRowAfter = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: captainId } });
      expect(captainRowAfter).toBeNull();

      // The erasure actually completed — not stuck retrying forever.
      const erasureRow = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { playerId: captainId } });
      expect(erasureRow.status).toBe(AccountErasureStatus.EXECUTED);
    });

    it('rejects handing off captaincy onto a teammate already mid-erasure themselves — 409 captain_transfer_target_mid_erasure', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createPlayer(teamId, {
        isCaptain: true,
      });
      const { playerId: midErasureId, sessionToken: midErasureToken } =
        await createPlayer(teamId);
      await createPlayer(teamId); // so midErasureId isn't captain-required to name a successor

      await requestErasure(midErasureToken);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: midErasureId })
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_transfer_target_mid_erasure',
      );
    });
  });

  describe('request -> confirm -> execute — last-player-deletes-team (Decision 5)', () => {
    it("deletes the entire team when the sole remaining player's erasure executes", async () => {
      const { teamId } = await createTeamFixture();
      const { playerId, sessionToken } = await createPlayer(teamId, {
        isCaptain: true,
      });

      await requestErasure(sessionToken);
      await confirmErasure(playerId);
      await backdateScheduledFor(playerId);

      await sweepService.sweep();

      const teamRow = await dataSource
        .getRepository(Team)
        .findOne({ where: { id: teamId } });
      expect(teamRow).toBeNull();
      const seasonRow = await dataSource
        .getRepository(Season)
        .findOne({ where: { teamId } });
      expect(seasonRow).toBeNull();
      const playerRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: playerId } });
      expect(playerRow).toBeNull();

      const erasureRow = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { playerId } });
      expect(erasureRow.status).toBe(AccountErasureStatus.EXECUTED);
    });
  });

  // Security-reviewer's 2026-07-29 refinement to Decision 5, exercised
  // against a real Postgres transaction/cascade via a real
  // `sweepService.sweep()` call — not mocks (account-erasure-sweep.
  // service.spec.ts/players.service.spec.ts's findAutoFallbackCaptainCandidate
  // suite already cover the batching logic in isolation; this covers the
  // real multi-row, same-team, same-run interaction those mocks can't).
  describe('multi-player, same-team, same-sweep-run batches (Decision 5)', () => {
    it("computes survivingCount across the WHOLE batch, not per-row: two of a two-player team's due erasures in the same run delete the entire team, not just each player individually", async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createPlayer(teamId, { isCaptain: true });
      const { playerId: memberId, sessionToken: memberToken } =
        await createPlayer(teamId);

      // The captain still has one teammate at request time, so
      // successorPlayerId is required — named here even though memberId is
      // about to erase in this same run too, which is fine: Decision 5's
      // survivingCount === 0 case never even looks at successorPlayerId
      // (the whole team, successor included, is being deleted).
      await requestErasure(captainToken, memberId);
      await confirmErasure(captainId);
      await backdateScheduledFor(captainId);

      await requestErasure(memberToken);
      await confirmErasure(memberId);
      await backdateScheduledFor(memberId);

      await sweepService.sweep();

      const teamRow = await dataSource
        .getRepository(Team)
        .findOne({ where: { id: teamId } });
      expect(teamRow).toBeNull();
      const captainRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: captainId } });
      expect(captainRow).toBeNull();
      const memberRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: memberId } });
      expect(memberRow).toBeNull();

      const erasureRows = await dataSource
        .getRepository(AccountErasureRequest)
        .find({ where: { playerId: In([captainId, memberId]) } });
      expect(erasureRows).toHaveLength(2);
      expect(
        erasureRows.every(
          (row) => row.status === AccountErasureStatus.EXECUTED,
        ),
      ).toBe(true);
    });

    // Note: this test does NOT exercise auto-fallback exclusion (code-critic
    // finding, 2026-07-29) — both departing players here either have a
    // still-valid named successor or aren't captain at all, so
    // resolveExecutionTimeSuccessor short-circuits on isSuccessorStillValid
    // returning true and never reaches findAutoFallbackCaptainCandidate.
    // What this actually (redundantly, but still validly) proves is that a
    // named-successor handoff for a PENDING-consent captain still works
    // correctly from inside a same-team, same-run batch, not just alone —
    // see the "auto-fallback correctly excludes a mid-erasure named
    // successor and a mid-erasure batch-mate" test below for the real
    // exclusion case.
    it('applies a named-successor handoff for a PENDING-consent captain inside a same-team batch — the surviving teammates are untouched', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createPlayer(teamId, {
          isCaptain: true,
          parentalConsentStatus: ParentalConsentStatus.PENDING,
        });
      const { playerId: successorId } = await createPlayer(teamId);
      const { playerId: otherDepartingId, sessionToken: otherDepartingToken } =
        await createPlayer(teamId);
      const { playerId: survivorId } = await createPlayer(teamId);

      // Two of this team's four players are due in the same run; two
      // survive (successorId, survivorId) — survivingCount === 2 > 0, so
      // each due row is processed individually, per Decision 5.
      await requestErasure(captainToken, successorId);
      await confirmErasure(captainId);
      await backdateScheduledFor(captainId);

      await requestErasure(otherDepartingToken);
      await confirmErasure(otherDepartingId);
      await backdateScheduledFor(otherDepartingId);

      await sweepService.sweep();

      const teamRow = await dataSource
        .getRepository(Team)
        .findOne({ where: { id: teamId } });
      expect(teamRow).not.toBeNull();

      const captainRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: captainId } });
      expect(captainRow).toBeNull();
      const otherDepartingRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: otherDepartingId } });
      expect(otherDepartingRow).toBeNull();

      // The named successor got the flag — despite the departing
      // captain's own pending consent (the same bug fix as above, now
      // exercised through the batched sweep path specifically).
      const successorRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: successorId } });
      expect(successorRow.isCaptain).toBe(true);

      // The uninvolved survivor is completely untouched.
      const survivorRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: survivorId } });
      expect(survivorRow.isCaptain).toBe(false);

      const erasureRows = await dataSource
        .getRepository(AccountErasureRequest)
        .find({ where: { playerId: In([captainId, otherDepartingId]) } });
      expect(erasureRows).toHaveLength(2);
      expect(
        erasureRows.every(
          (row) => row.status === AccountErasureStatus.EXECUTED,
        ),
      ).toBe(true);
    });

    // The real end-to-end case the security-reviewer's Decision 5
    // refinement (batched sweep, exclude-mid-erasure-teammates-from-
    // fallback) exists to fix — code-critic finding, 2026-07-29: the test
    // above never actually reaches findAutoFallbackCaptainCandidate, since
    // its named successor stays valid the whole time. This one forces the
    // named successor to become invalid strictly BETWEEN the captain's own
    // confirm (where the successor is still valid) and their execution
    // (where the successor now has an active erasure request of their
    // own) — so isSuccessorStillValid's execution-time re-check is what
    // actually triggers the fallback, not confirm-time clearing.
    it('auto-fallback correctly excludes a mid-erasure named successor and a mid-erasure batch-mate, picking the one genuinely-surviving candidate', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createPlayer(teamId, { isCaptain: true });
      // Named successor at request time — will invalidate themselves by
      // starting their own erasure before the captain's execution.
      const {
        playerId: invalidatedSuccessorId,
        sessionToken: invalidatedSuccessorToken,
      } = await createPlayer(teamId);
      // The only genuinely-surviving candidate — must end up captain.
      const { playerId: fallbackId } = await createPlayer(teamId);
      // A second, simultaneously-mid-erasure teammate in the SAME batch as
      // the captain — an additional candidate that must also be excluded,
      // via Decision 5's batch-exclusion (not the erasure-status exclusion
      // above, which is what excludes invalidatedSuccessorId).
      const { playerId: batchMateId, sessionToken: batchMateToken } =
        await createPlayer(teamId);

      // Captain names invalidatedSuccessorId — required, and genuinely
      // valid at both request and confirm time (nobody else has requested
      // anything yet).
      await requestErasure(captainToken, invalidatedSuccessorId);
      await confirmErasure(captainId);

      // Only AFTER the captain's own confirm does the named successor
      // start their own erasure — reaching an active (requested) status.
      // Still nominally "on the team" (their own Player row isn't deleted
      // until their own erasure executes, which never happens in this
      // run), so a query that only checked team membership would
      // incorrectly still consider them eligible.
      await requestErasure(invalidatedSuccessorToken);

      // A second batch-mate, due in the SAME sweep run as the captain —
      // must be excluded from the fallback pool by Decision 5's whole-
      // batch exclusion, not just the erasure-status check above.
      await requestErasure(batchMateToken);
      await confirmErasure(batchMateId);
      await backdateScheduledFor(batchMateId);

      await backdateScheduledFor(captainId);

      await sweepService.sweep();

      // The team survives (invalidatedSuccessorId and fallbackId remain),
      // so this goes through the per-row path, not the team-cascade path.
      const teamRow = await dataSource
        .getRepository(Team)
        .findOne({ where: { id: teamId } });
      expect(teamRow).not.toBeNull();

      // The captain and the second batch-mate are both gone.
      const captainRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: captainId } });
      expect(captainRow).toBeNull();
      const batchMateRow = await dataSource
        .getRepository(Player)
        .findOne({ where: { id: batchMateId } });
      expect(batchMateRow).toBeNull();

      // The genuinely-surviving candidate got the flag.
      const fallbackRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: fallbackId } });
      expect(fallbackRow.isCaptain).toBe(true);

      // The invalidated named successor is still on the team (their own
      // erasure hasn't executed) but was correctly NOT considered —
      // exactly the case a naive "just query current teammates" approach
      // would get wrong.
      const invalidatedSuccessorRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: invalidatedSuccessorId } });
      expect(invalidatedSuccessorRow.isCaptain).toBe(false);

      const captainErasureRow = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { playerId: captainId } });
      expect(captainErasureRow.status).toBe(AccountErasureStatus.EXECUTED);

      // The invalidated successor's own (still in-flight, unrelated)
      // erasure request is untouched by this run.
      const invalidatedSuccessorErasureRow = await dataSource
        .getRepository(AccountErasureRequest)
        .findOneOrFail({ where: { playerId: invalidatedSuccessorId } });
      expect(invalidatedSuccessorErasureRow.status).toBe(
        AccountErasureStatus.REQUESTED,
      );
    });
  });
});
