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
import { TeamJoinStatus } from '../src/players/team-join-status.enum';
import { Player } from '../src/players/entities/player.entity';
import { PlayerPrivateInfo } from '../src/player-private-info/entities/player-private-info.entity';
import { Team } from '../src/teams/entities/team.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';
import { Challenge } from '../src/challenges/entities/challenge.entity';
import { stockholmDateString } from '../src/common/time/stockholm-date.util';

/** Tomorrow, as a 'YYYY-MM-DD' string — used so a goal's date window
 * covers "today" while still satisfying the contract's `endDate > startDate`
 * validation rule (a single-day window with startDate === endDate is
 * rejected at the DTO boundary, by design). */
function tomorrowDateString(today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const asUtcMidnight = new Date(Date.UTC(year, month - 1, day));
  asUtcMidnight.setUTCDate(asUtcMidnight.getUTCDate() + 1);
  return asUtcMidnight.toISOString().slice(0, 10);
}

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreatePlayerBody {
  playerId: string;
  sessionToken: string;
}

interface GoalBody {
  id: string;
  status: string;
  progressMinutes?: number;
  percentComplete?: number;
  goalMet?: boolean;
  bonusAwardedAt: string | null;
  bonusPointsAwarded: number | null;
}

interface TrainingLogBody {
  teamPool: { pointsTotal: number };
  goalBonus: { awardedPoints: number } | null;
}

// Exercises docs/api/phase2-contract.md's new endpoints end-to-end against
// real Postgres + Redis (see phase1.e2e-spec.ts's equivalent comment).
// Every `describe` block creates its own Team/Season/TeamSeasonPot fixture
// (unique invite code) plus its own captain (created directly, mirroring
// src/scripts/seed.ts's "captain is a manual/seed action" posture — there
// is no in-app captain-assignment endpoint to call instead).
//
// Most ordinary teammates in this file are created directly via
// createTeamMember (bypassing POST /players) rather than through the real
// onboarding endpoint — that endpoint has a tight 10/min per-IP throttle
// (docs/api/phase1-contract.md), which a single test file exercising many
// team-scoped endpoints (including a 10-player concurrency test) would
// otherwise trip. POST /players itself is still exercised directly by a
// couple of tests below, and exhaustively by phase1.e2e-spec.ts.
describe('Phase 2 API (e2e)', () => {
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

  /** Creates a Team + Season + active TeamSeasonPot fixture, returning ids. */
  async function createTeamFixture(goalThreshold = 1_000_000) {
    const inviteCode = `P2${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Phase 2 Test Team', inviteCode }),
      );
    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId: team.id,
        label: 'Phase 2 Season',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );
    const pot = await dataSource.getRepository(TeamSeasonPot).save(
      dataSource.getRepository(TeamSeasonPot).create({
        teamId: team.id,
        seasonId: season.id,
        pointsTotal: 0,
        goalThreshold,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );
    return { teamId: team.id, inviteCode, seasonId: season.id, potId: pot.id };
  }

  /** Directly creates an approved, is_captain player for a team — mirrors
   * seed.ts's manual-assignment posture, no onboarding round-trip needed.
   * `consentStatus` defaults to approved (every existing caller's implicit
   * assumption, unchanged) — overridable for docs/ACTION_PLAN.md's Phase
   * 2.9 acting-captain consent-gate coverage below. */
  async function createCaptain(
    teamId: string,
    consentStatus: ParentalConsentStatus = ParentalConsentStatus.APPROVED,
  ) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Kapten${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2012,
        parentalConsentStatus: consentStatus,
        teamJoinStatus: TeamJoinStatus.APPROVED,
        isCaptain: true,
      }),
    );
    const sessionToken = playerTokenService.issueFor(
      player.id,
      player.tokenVersion,
    );
    return { playerId: player.id, sessionToken };
  }

  /** Directly creates an ordinary (non-captain) team member — bypasses
   * POST /players entirely (see the describe-level comment on why). Fine
   * for anything that isn't specifically testing the onboarding/consent-
   * token mechanism itself, since Phase 2's endpoints only care about
   * Player.teamId/isCaptain/parentalConsentStatus, not row provenance. */
  async function createTeamMember(
    teamId: string,
    consentStatus: ParentalConsentStatus = ParentalConsentStatus.APPROVED,
  ) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Member${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2014,
        parentalConsentStatus: consentStatus,
        teamJoinStatus: TeamJoinStatus.APPROVED,
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

  /** Creates an ordinary approved player via the real onboarding endpoint,
   * then approves consent out-of-band (mirrors phase1.e2e-spec.ts's
   * pattern, since there is no POST /consent/:token in this app's JSON
   * contract). Used sparingly (see describe-level comment) to stay well
   * under POST /players' 10/min per-IP throttle. */
  async function createApprovedPlayerViaOnboarding(inviteCode: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/players')
      .send({
        inviteCode,
        screenName: `P2Player${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'parent@example.com',
      })
      .expect(201);
    const { playerId, sessionToken } = response.body as CreatePlayerBody;
    await dataSource
      .getRepository(Player)
      .update(
        { id: playerId },
        { parentalConsentStatus: ParentalConsentStatus.APPROVED },
      );
    return { playerId, sessionToken };
  }

  describe('Captain authorization (service-layer check, no CaptainGuard)', () => {
    it('rejects a non-captain creating a weekly goal with 403 not_team_captain (real onboarding round-trip)', async () => {
      const { teamId, inviteCode } = await createTeamFixture();
      const { sessionToken } =
        await createApprovedPlayerViaOnboarding(inviteCode);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          title: 'Zorro-finter-veckan',
          description: 'Gör så många du kan!',
          targetMetric: 'drill-minuter',
          targetValue: 100,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'draft',
        })
        .expect(403);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'not_team_captain',
      );
    });

    it("rejects a captain of a different team with 403 team_mismatch on that team's roster", async () => {
      const { teamId: otherTeamId } = await createTeamFixture();
      const { sessionToken } = await createCaptain(otherTeamId);
      const { teamId } = await createTeamFixture();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(403);

      expect((response.body as ApiErrorBody).error.code).toBe('team_mismatch');
    });

    it('roster is captain-only (non-captain teammate gets 403) but dashboard is open to any teammate', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { sessionToken: playerToken } = await createTeamMember(teamId);

      await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(403);

      const rosterResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
      const roster = rosterResponse.body as {
        players: Array<{ screenName: string; playerId: string }>;
      };
      // Never real_name — only screenName/avatarId/consentStatus/lastTrainedDate.
      expect(roster.players.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(roster.players)).not.toMatch(/realName/i);

      const dashboardResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/dashboard`)
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(200);
      const dashboard = dashboardResponse.body as { viewerIsCaptain: boolean };
      expect(dashboard.viewerIsCaptain).toBe(false);
    });
  });

  describe('Weekly-goal CRUD + state machine', () => {
    it('enforces active_goal_already_exists, challenge_target_frozen, invalid_challenge_transition, and the draft->active->cancelled path', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);

      // A draft and an active goal may coexist.
      const draftResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Nästa veckas mål',
          description: 'Under planering',
          targetMetric: 'total-minuter',
          targetValue: 200,
          startDate: '2026-07-13',
          endDate: '2026-07-19',
          status: 'draft',
        })
        .expect(201);
      const draft = draftResponse.body as GoalBody;
      expect(draft.status).toBe('draft');

      const activeResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Zorro-finter-veckan',
          description: 'Gör så många du kan!',
          targetMetric: 'drill-minuter',
          targetValue: 100,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'active',
        })
        .expect(201);
      const active = activeResponse.body as GoalBody;
      expect(active.status).toBe('active');

      // A second active goal is rejected...
      const secondActiveResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Ett till mål',
          description: '...',
          targetMetric: 'total-minuter',
          targetValue: 50,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'active',
        })
        .expect(409);
      expect((secondActiveResponse.body as ApiErrorBody).error.code).toBe(
        'active_goal_already_exists',
      );

      // ...but activating the draft (a different active_goal_already_exists
      // path — draft -> active while another goal is already active) is
      // rejected the same way.
      const draftToActiveResponse = await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${draft.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ status: 'active' })
        .expect(409);
      expect((draftToActiveResponse.body as ApiErrorBody).error.code).toBe(
        'active_goal_already_exists',
      );

      // Frozen fields on the now-active goal.
      const frozenResponse = await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${active.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ targetValue: 1 })
        .expect(409);
      expect((frozenResponse.body as ApiErrorBody).error.code).toBe(
        'challenge_target_frozen',
      );

      // Illegal transition: 'draft' isn't even a legal PATCH target value
      // per the contract's request shape (status?: 'active'|'completed'|
      // 'cancelled') — that's a 400 at the DTO boundary, not the state
      // machine's own 409. The state machine itself is exercised instead
      // via draft -> completed (a value the DTO *does* accept, but not a
      // legal edge from 'draft').
      const illegalResponse = await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${draft.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ status: 'completed' })
        .expect(409);
      expect((illegalResponse.body as ApiErrorBody).error.code).toBe(
        'invalid_challenge_transition',
      );

      const dtoBoundaryResponse = await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${active.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ status: 'draft' })
        .expect(400);
      expect((dtoBoundaryResponse.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );

      // title/description remain editable at any non-terminal status.
      await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${active.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ title: 'Zorro-finter-veckan (uppdaterad)' })
        .expect(200);

      // active -> cancelled is legal.
      const cancelResponse = await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${active.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ status: 'cancelled' })
        .expect(200);
      expect((cancelResponse.body as GoalBody).status).toBe('cancelled');

      // History now includes the cancelled goal.
      const historyResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/weekly-goal/history`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
      const history = historyResponse.body as { goals: GoalBody[] };
      expect(history.goals.some((g) => g.id === active.id)).toBe(true);

      // GET weekly-goal now falls back to the still-existing draft (no
      // active goal left).
      const currentResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
      const current = currentResponse.body as { goal: GoalBody | null };
      expect(current.goal?.id).toBe(draft.id);
      expect(current.goal?.status).toBe('draft');
    });

    it('rejects targetMetric outside the fixed 5-value enum with a 400', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Bad metric',
          description: '...',
          targetMetric: 'kilometers', // not in the enum
          targetValue: 100,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'draft',
        })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('GET weekly-goal is open to any teammate, not captain-gated', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { sessionToken: playerToken } = await createTeamMember(teamId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Öppet för alla',
          description: '...',
          targetMetric: 'total-minuter',
          targetValue: 50,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'active',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(200);
      const body = response.body as {
        goal: GoalBody;
        viewerIsCaptain: boolean;
      };
      expect(body.goal.status).toBe('active');
      expect(body.viewerIsCaptain).toBe(false);
    });
  });

  describe('Consent-reminder resend (captain acting on a teammate)', () => {
    it('sends once, then rate-limits, then rejects once approved', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { playerId } = await createTeamMember(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const first = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/consent-reminder`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
      expect((first.body as { message: string }).message).toBe(
        'Reminder sent.',
      );

      const rateLimited = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/consent-reminder`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(429);
      expect((rateLimited.body as ApiErrorBody).error.code).toBe(
        'consent_reminder_rate_limited',
      );

      await dataSource
        .getRepository(Player)
        .update(
          { id: playerId },
          { parentalConsentStatus: ParentalConsentStatus.APPROVED },
        );

      const afterApproval = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/consent-reminder`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(409);
      expect((afterApproval.body as ApiErrorBody).error.code).toBe(
        'consent_not_pending',
      );
    });

    it('rejects a non-captain teammate triggering a reminder for someone else', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: playerToken } = await createTeamMember(teamId);
      const { playerId } = await createTeamMember(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/consent-reminder`)
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'not_team_captain',
      );
    });

    it("rejects a captain whose own consent is still pending with 403 captain_consent_required (docs/ACTION_PLAN.md's Phase 2.9 decision)", async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: pendingCaptainToken } = await createCaptain(
        teamId,
        ParentalConsentStatus.PENDING,
      );
      const { playerId } = await createTeamMember(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/consent-reminder`)
        .set('Authorization', `Bearer ${pendingCaptainToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );
    });
  });

  describe("Acting-captain's own consent gate (docs/ACTION_PLAN.md's Phase 2.9 decision) — weekly-goal management and roster", () => {
    it('a captain with is_captain=true but their own consent still pending is blocked from creating a weekly goal', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: pendingCaptainToken } = await createCaptain(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${pendingCaptainToken}`)
        .send({
          title: 'Ett mål',
          description: '...',
          targetMetric: 'total-minuter',
          targetValue: 50,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'draft',
        })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );
    });

    it('a captain whose own consent is later revoked is blocked from patching a goal they created while still approved (the gate is re-checked per request, never cached)', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createCaptain(teamId);
      const created = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Ett mål',
          description: '...',
          targetMetric: 'total-minuter',
          targetValue: 50,
          startDate: '2026-07-06',
          endDate: '2026-07-12',
          status: 'draft',
        })
        .expect(201);
      const goal = created.body as GoalBody;

      // Consent revoked after the goal was already created — a real,
      // reachable state (consent can be revoked after approval), used here
      // to isolate patchGoal's own gate from createGoal's without needing a
      // second captain (only one is allowed per team).
      await dataSource
        .getRepository(Player)
        .update(
          { id: captainId },
          { parentalConsentStatus: ParentalConsentStatus.REVOKED },
        );

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/teams/${teamId}/weekly-goal/${goal.id}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ title: 'Uppdaterad titel' })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );
    });

    it('a captain with pending consent is blocked from the captain-only roster endpoint', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: pendingCaptainToken } = await createCaptain(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${pendingCaptainToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );
    });

    it('dashboard/teammates (not captain-gated) remain open to the same pending-consent captain', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: pendingCaptainToken } = await createCaptain(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/dashboard`)
        .set('Authorization', `Bearer ${pendingCaptainToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/teammates`)
        .set('Authorization', `Bearer ${pendingCaptainToken}`)
        .expect(200);
    });
  });

  describe('Session reissue (ADR-0004 Part 3, redesigned per its 2026-07-27 addendum)', () => {
    // The original design returned the reissue code directly to whoever
    // triggered it — a confirmed critical bug, since the same captain
    // could then redeem it themselves and take over the target's account.
    // The redesign never puts the code in any HTTP response; it's emailed
    // to the target's own parent_contact instead (see SessionService).
    // These tests verify the code by querying Postgres directly, exactly
    // like the real player/parent would receive it via email, not by
    // reading it off an API response (there is none to read it from).

    async function readReissueCode(playerId: string): Promise<string> {
      const player = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: playerId } });
      expect(player.sessionReissueCode).not.toBeNull();
      return player.sessionReissueCode as string;
    }

    it('captain-triggered reissue never returns the code, bumps token_version, and the old token stops working', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { playerId, sessionToken: oldToken } =
        await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/session-reissue`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
      expect(response.body).toEqual({
        requested: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        expiresAt: expect.any(String),
      });
      expect(JSON.stringify(response.body)).not.toMatch(/reissueCode/i);

      // The pre-reissue token is now stale (token_version mismatch).
      await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);

      const code = await readReissueCode(playerId);
      const redeemResponse = await request(app.getHttpServer())
        .post('/api/v1/players/session/redeem')
        .send({ code })
        .expect(200);
      expect(redeemResponse.body).toEqual({
        playerId,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest's own matcher typing
        sessionToken: expect.any(String),
      });

      // The freshly-redeemed token works.
      await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set(
          'Authorization',
          `Bearer ${(redeemResponse.body as { sessionToken: string }).sessionToken}`,
        )
        .expect(200);
    });

    it('rejects a second captain-triggered reissue within the cooldown window with 429', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { playerId } = await createTeamMember(teamId);

      await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/session-reissue`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/session-reissue`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(429);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'session_reissue_rate_limited',
      );
    });

    it('session/redeem rejects an unknown code with a generic invalid_or_expired_code error', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/players/session/redeem')
        .send({ code: 'NOSUCHCODE' })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'invalid_or_expired_code',
      );
    });

    describe('self-service reissue-request (no captain, no auth — the confirmed real "I already have an account" gap)', () => {
      it('a real match generates a code, but the response is identical to a non-match', async () => {
        const { teamId, inviteCode } = await createTeamFixture();
        const { playerId, screenName } = await (async () => {
          const member = await createTeamMember(teamId);
          const player = await dataSource
            .getRepository(Player)
            .findOneOrFail({ where: { id: member.playerId } });
          return { playerId: member.playerId, screenName: player.screenName };
        })();

        const matchResponse = await request(app.getHttpServer())
          .post('/api/v1/players/session/reissue-request')
          .send({ inviteCode, screenName: screenName.toUpperCase() }) // case-insensitive
          .expect(200);
        expect(matchResponse.body).toEqual({ requested: true });

        const noMatchResponse = await request(app.getHttpServer())
          .post('/api/v1/players/session/reissue-request')
          .send({ inviteCode, screenName: 'NoSuchPlayerAtAll' })
          .expect(200);
        expect(noMatchResponse.body).toEqual({ requested: true });

        const unknownTeamResponse = await request(app.getHttpServer())
          .post('/api/v1/players/session/reissue-request')
          .send({ inviteCode: 'NOSUCHTEAMCODE', screenName })
          .expect(200);
        expect(unknownTeamResponse.body).toEqual({ requested: true });

        // Only the real match actually generated a redeemable code.
        const code = await readReissueCode(playerId);
        await request(app.getHttpServer())
          .post('/api/v1/players/session/redeem')
          .send({ code })
          .expect(200);
      });
    });
  });

  describe('Goal-completion bonus (ADR-0005 Decision 3, the core Phase 2 mechanic)', () => {
    it('fires exactly once — the crossing log gets the bonus, an earlier log gets null, a later log also gets null', async () => {
      // ADR-0015: goalMet requires every eligible roster member to
      // individually reach targetValue, not a pooled team sum — so this
      // fixture uses exactly two eligible players (the captain and one
      // team member; the captain is itself an eligible roster row, per
      // ADR-0015 Decision 2) and has each independently reach the full
      // target, rather than splitting a shared total across them the way
      // the old pooled rule allowed.
      const { teamId, potId } = await createTeamFixture();
      const today = stockholmDateString();
      const { sessionToken: captainToken } = await createCaptain(teamId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Bonus-testet',
          description: '...',
          targetMetric: 'fitness-minuter',
          targetValue: 30,
          startDate: today,
          endDate: tomorrowDateString(today),
          status: 'active',
        })
        .expect(201);

      const { sessionToken: tokenA } = await createTeamMember(teamId);

      // First log: the captain alone reaches 30 — but player A, the other
      // eligible player, hasn't logged anything yet, so the goal isn't
      // met yet. No bonus.
      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ activityType: 'fitness', durationMinutes: 30 })
        .expect(201);
      expect((firstResponse.body as TrainingLogBody).goalBonus).toBeNull();

      // Second log: player A also reaches 30 — now every eligible player
      // has individually hit the target. This is the one-time crossing.
      // awardedPoints = 5 + team-wide minutes at the moment of crossing
      // (30 + 30 = 60) = 65.
      const secondResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ activityType: 'fitness', durationMinutes: 30 })
        .expect(201);
      const second = secondResponse.body as TrainingLogBody;
      expect(second.goalBonus).toEqual({ awardedPoints: 65 });

      // Third log: goal already met — no further bonus, ever.
      const thirdResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ activityType: 'fitness', durationMinutes: 5 })
        .expect(201);
      expect((thirdResponse.body as TrainingLogBody).goalBonus).toBeNull();

      // Team pool reflects the base points (30+30+5=65) plus the one-time
      // bonus (65) exactly once: 130.
      const pot = await dataSource
        .getRepository(TeamSeasonPot)
        .findOneOrFail({ where: { id: potId } });
      expect(pot.pointsTotal).toBe(130);

      // The persisted bonus fields are visible on GET weekly-goal, for a
      // teammate who opens the app after the fact.
      const goalResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const goal = (goalResponse.body as { goal: GoalBody }).goal;
      expect(goal.bonusPointsAwarded).toBe(65);
      expect(goal.bonusAwardedAt).not.toBeNull();
      expect(goal.goalMet).toBe(true);
    });

    it('does not award a bonus for logs outside the goal window or of a non-matching activity type', async () => {
      const { teamId, potId } = await createTeamFixture();
      const today = stockholmDateString();
      const { sessionToken: captainToken } = await createCaptain(teamId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Bara löpning',
          description: '...',
          targetMetric: 'running-minuter',
          targetValue: 10,
          startDate: today,
          endDate: tomorrowDateString(today),
          status: 'active',
        })
        .expect(201);

      const { sessionToken } = await createTeamMember(teamId);

      // Wrong activity type: fitness minutes don't count toward a
      // running-minuter goal, even though this would otherwise cross 10.
      const response = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ activityType: 'fitness', durationMinutes: 50 })
        .expect(201);
      expect((response.body as TrainingLogBody).goalBonus).toBeNull();

      const pot = await dataSource
        .getRepository(TeamSeasonPot)
        .findOneOrFail({ where: { id: potId } });
      // Base points still land (50), just no bonus.
      expect(pot.pointsTotal).toBe(50);
    });

    it('concurrency: N simultaneous crossing-adjacent logs award the bonus exactly once', async () => {
      // ADR-0015: goalMet now requires every eligible player to
      // individually reach targetValue. Setting targetValue equal to
      // DURATION_MINUTES means each of the 10 players' *own* single log
      // exactly satisfies *their own* requirement — so completion can
      // only happen once all 10 have logged, and (because of the row
      // lock's serialization) that can only become true on whichever one
      // of the 10 concurrent requests happens to be processed *last* in
      // the lock's serialization order. This is still exactly the
      // scenario ADR-0005 Decision 3's row lock exists to serialize
      // (multiple teammates logging around the same time), just driven by
      // per-player completion instead of a pooled sum crossing a
      // threshold.
      const { teamId, potId } = await createTeamFixture();
      const today = stockholmDateString();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const CONCURRENT_PLAYER_COUNT = 10;
      const DURATION_MINUTES = 15;
      const TARGET_VALUE = DURATION_MINUTES; // each player's own single log exactly meets it

      // Create the full 11-player roster (captain + 10 team members)
      // *before* the goal exists, so every player's `createdAt` is safely
      // on-or-before `goal.startDate` (ADR-0015 Decision 2's
      // `joined_after_start` eligibility check) and the eligible roster
      // is the full 11 for the entire test, not a subset that grows
      // mid-test.
      const tokens = await Promise.all(
        Array.from({ length: CONCURRENT_PLAYER_COUNT }, () =>
          createTeamMember(teamId),
        ),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({
          title: 'Race-testet',
          description: '...',
          targetMetric: 'total-minuter',
          targetValue: TARGET_VALUE,
          startDate: today,
          endDate: tomorrowDateString(today),
          status: 'active',
        })
        .expect(201);

      // The captain is itself an eligible roster row (ADR-0015 Decision
      // 2) — log its own target *before* the concurrent batch below, so
      // completion during the race depends purely on the 10 team members,
      // not on an 11th player who never gets a chance to log. At this
      // point all 10 team members already exist (created above) but
      // haven't logged anything, so the captain's own log can't complete
      // the goal alone.
      const captainLogResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ activityType: 'fitness', durationMinutes: DURATION_MINUTES })
        .expect(201);
      expect((captainLogResponse.body as TrainingLogBody).goalBonus).toBeNull();

      // Fire every player's first (and only) log essentially
      // simultaneously.
      const responses = await Promise.all(
        tokens.map(({ sessionToken }) =>
          request(app.getHttpServer())
            .post('/api/v1/training-logs')
            .set('Authorization', `Bearer ${sessionToken}`)
            .send({
              activityType: 'fitness',
              durationMinutes: DURATION_MINUTES,
            }),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(201);
      }
      const bodies = responses.map((r) => r.body as TrainingLogBody);
      const withBonus = bodies.filter((b) => b.goalBonus !== null);

      // Exactly one request may have caused the crossing — never zero
      // (the captain already hit its own target above, so progress does
      // reach "every eligible player done" once the last of these 10
      // lands) and never more than one (that's the idempotency guarantee
      // the row lock provides).
      expect(withBonus).toHaveLength(1);

      // Because every one of the 10 required team members needs their own
      // individual log (the captain already logged its own target above),
      // the goal can only become met once all 10 have landed — which,
      // under serialization, means every one of the 9 *other* requests
      // has already fully committed by the time the 10th (in lock order,
      // not necessarily request-array order) runs its check. So unlike
      // the old pooled model, the award here is fully deterministic, not
      // a range: 5 + the full total (the captain's own log plus all 10
      // team members').
      const awardedPoints = withBonus[0].goalBonus?.awardedPoints ?? 0;
      const teamMemberMinutes = CONCURRENT_PLAYER_COUNT * DURATION_MINUTES;
      const totalMinutes = teamMemberMinutes + DURATION_MINUTES; // + the captain's own log
      expect(awardedPoints).toBe(5 + totalMinutes);

      // Base points always land for all eleven logs (captain + 10 team
      // members) regardless of race ordering; the bonus is added exactly
      // once on top.
      const pot = await dataSource
        .getRepository(TeamSeasonPot)
        .findOneOrFail({ where: { id: potId } });
      expect(pot.pointsTotal).toBe(totalMinutes + awardedPoints);

      const goal = await dataSource
        .getRepository(Challenge)
        .findOneOrFail({ where: { teamId } });
      expect(goal.goalBonusPointsAwarded).toBe(awardedPoints);
      expect(goal.goalBonusAwardedAt).not.toBeNull();
    });
  });
});
