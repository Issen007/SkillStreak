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
   * seed.ts's manual-assignment posture, no onboarding round-trip needed. */
  async function createCaptain(teamId: string) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Kapten${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2012,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
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
  });

  describe('Session reissue (ADR-0004 Part 3, captain-triggered)', () => {
    it('invalidates the old token immediately, then a redeemed code issues a working new one', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { playerId, sessionToken: oldToken } =
        await createTeamMember(teamId);

      // Old token works before reissue.
      await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(200);

      const reissueResponse = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerId}/session-reissue`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
      const { reissueCode } = reissueResponse.body as {
        reissueCode: string;
        expiresAt: string;
      };
      expect(reissueCode).toHaveLength(8);

      // Old token now fails — token_version was bumped immediately.
      const oldTokenResponse = await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);
      expect((oldTokenResponse.body as ApiErrorBody).error.code).toBe(
        'unauthorized',
      );

      // A wrong code is rejected generically.
      const badRedeem = await request(app.getHttpServer())
        .post('/api/v1/players/session/redeem')
        .send({ code: 'WRONGCODE' })
        .expect(400);
      expect((badRedeem.body as ApiErrorBody).error.code).toBe(
        'invalid_or_expired_code',
      );

      // Redeeming the real code issues a fresh, working token.
      const redeemResponse = await request(app.getHttpServer())
        .post('/api/v1/players/session/redeem')
        .send({ code: reissueCode })
        .expect(200);
      const { sessionToken: newToken, playerId: redeemedPlayerId } =
        redeemResponse.body as { sessionToken: string; playerId: string };
      expect(redeemedPlayerId).toBe(playerId);

      await request(app.getHttpServer())
        .get('/api/v1/players/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);

      // Single-use: redeeming the same code again fails.
      const secondRedeem = await request(app.getHttpServer())
        .post('/api/v1/players/session/redeem')
        .send({ code: reissueCode })
        .expect(400);
      expect((secondRedeem.body as ApiErrorBody).error.code).toBe(
        'invalid_or_expired_code',
      );
    });

    it('rejects a non-captain triggering session-reissue for a teammate', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: playerAToken } = await createTeamMember(teamId);
      const { playerId: playerBId } = await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/players/${playerBId}/session-reissue`)
        .set('Authorization', `Bearer ${playerAToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'not_team_captain',
      );
    });
  });

  describe('Goal-completion bonus (ADR-0005 Decision 3, the core Phase 2 mechanic)', () => {
    it('fires exactly once — the crossing log gets the bonus, an earlier log gets null, a later log also gets null', async () => {
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
      const { sessionToken: tokenB } = await createTeamMember(teamId);

      // First log (20 min): below target — no bonus.
      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ activityType: 'fitness', durationMinutes: 20 })
        .expect(201);
      expect((firstResponse.body as TrainingLogBody).goalBonus).toBeNull();

      // Second log (15 min): team-wide progress is now 35 >= 30 — this is
      // the one-time crossing. awardedPoints = 5 + 35 = 40.
      const secondResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ activityType: 'fitness', durationMinutes: 15 })
        .expect(201);
      const second = secondResponse.body as TrainingLogBody;
      expect(second.goalBonus).toEqual({ awardedPoints: 40 });

      // Third log: goal already met — no further bonus, ever.
      const thirdResponse = await request(app.getHttpServer())
        .post('/api/v1/training-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ activityType: 'fitness', durationMinutes: 5 })
        .expect(201);
      expect((thirdResponse.body as TrainingLogBody).goalBonus).toBeNull();

      // Team pool reflects the base points (20+15+5=40) plus the one-time
      // bonus (40) exactly once: 80.
      const pot = await dataSource
        .getRepository(TeamSeasonPot)
        .findOneOrFail({ where: { id: potId } });
      expect(pot.pointsTotal).toBe(80);

      // The persisted bonus fields are visible on GET weekly-goal, for a
      // teammate who opens the app after the fact.
      const goalResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const goal = (goalResponse.body as { goal: GoalBody }).goal;
      expect(goal.bonusPointsAwarded).toBe(40);
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
      const { teamId, potId } = await createTeamFixture();
      const today = stockholmDateString();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const TARGET_VALUE = 100;
      const CONCURRENT_PLAYER_COUNT = 10;
      const DURATION_MINUTES = 15; // 10 * 15 = 150 >= 100, crosses partway through

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

      const tokens = await Promise.all(
        Array.from({ length: CONCURRENT_PLAYER_COUNT }, () =>
          createTeamMember(teamId),
        ),
      );

      // Fire every player's first log essentially simultaneously — this is
      // exactly the scenario ADR-0005 Decision 3's row lock exists to
      // serialize (multiple teammates logging around the same time near
      // the end of the week).
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
      // (progress does reach the target) and never more than one (that's
      // the idempotency guarantee the row lock provides).
      expect(withBonus).toHaveLength(1);

      // awardedPoints = 5 + progress-*at-the-moment-of-crossing*, per
      // ADR-0005 Decision 3 — NOT 5 + the eventual grand total. Under real
      // concurrency, the row lock serializes the ten requests into *some*
      // arrival order, and whichever one is the first (in that order) to
      // push cumulative progress past TARGET_VALUE is "the crossing," using
      // only the logs committed so far — which may be fewer than all ten.
      // So the exact award isn't predictable, but it must be
      // `5 + a multiple of DURATION_MINUTES that's >= TARGET_VALUE and
      // <= the grand total` (every log here is the same size).
      const awardedPoints = withBonus[0].goalBonus?.awardedPoints ?? 0;
      const totalMinutes = CONCURRENT_PLAYER_COUNT * DURATION_MINUTES;
      const progressAtCrossing = awardedPoints - 5;
      expect(progressAtCrossing % DURATION_MINUTES).toBe(0);
      expect(progressAtCrossing).toBeGreaterThanOrEqual(TARGET_VALUE);
      expect(progressAtCrossing).toBeLessThanOrEqual(totalMinutes);

      // Base points always land for all ten logs regardless of race
      // ordering; the bonus, whatever its exact amount, is added exactly
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
