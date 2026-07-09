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
import { Season } from '../src/team-pool/entities/season.entity';
import { Team } from '../src/teams/entities/team.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreatePlayerBody {
  playerId: string;
  teamId: string;
  teamName: string;
  teamCreated: boolean;
  isCaptain: boolean;
  screenName: string;
  avatarId: string;
  consentStatus: string;
  sessionToken: string;
}

function uniqueScreenName(prefix: string): string {
  return `${prefix}${randomUUID().slice(0, 6)}`;
}

function uniqueInviteCode(prefix: string): string {
  return `${prefix}${randomUUID().slice(0, 8).toUpperCase()}`;
}

// Exercises docs/adr/0009-self-service-team-creation.md /
// docs/api/phase1-contract.md's 2026-07-09 addendum end-to-end against real
// Postgres + Redis, mirroring phase1.e2e-spec.ts's/phase2.e2e-spec.ts's
// fixture-creation conventions. See
// self-service-team-creation-concurrency.e2e-spec.ts for the dedicated
// invite-code-race coverage (ADR-0009 Decision 8), mirrored on
// captain-transfer-concurrency.e2e-spec.ts.
describe('Fas 2.9: self-service team creation (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

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
  });

  afterAll(async () => {
    await app.close();
  });

  /** An ordinary, already-existing Team + Season + active TeamSeasonPot —
   * the "join" side of every test below that needs one. */
  async function createExistingTeamFixture() {
    const inviteCode = uniqueInviteCode('SSTC');
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Pre-existing Team', inviteCode }),
      );
    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId: team.id,
        label: 'SSTC Season',
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
    return { teamId: team.id, inviteCode };
  }

  // Deliberately NOT `async` — returns the chainable supertest Test object
  // itself (not a Promise wrapping it), so every call site can chain its
  // own `.expect(status)` the same way a direct `request(...)` call would.
  function postPlayers(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/players').send(body);
  }

  describe('Creating a brand-new team (inviteCode matches nothing, teamName supplied)', () => {
    it('creates the team + an active Season/TeamSeasonPot atomically, echoes teamName, and makes this player the captain', async () => {
      const inviteCode = uniqueInviteCode('NEW');
      const teamName = 'Nya Falkarna P12';

      const response = await postPlayers({
        inviteCode,
        teamName,
        screenName: uniqueScreenName('Creator'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'creator-parent@example.com',
      }).expect(201);

      const body = response.body as CreatePlayerBody;
      expect(body.teamName).toBe(teamName);
      expect(body.teamCreated).toBe(true);
      expect(body.isCaptain).toBe(true);
      expect(body.consentStatus).toBe('pending');
      expect(typeof body.sessionToken).toBe('string');

      // The team, invite code, and captain flag are durably persisted.
      const team = await dataSource
        .getRepository(Team)
        .findOneOrFail({ where: { id: body.teamId } });
      expect(team.name).toBe(teamName);
      expect(team.inviteCode).toBe(inviteCode);

      const player = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: body.playerId } });
      expect(player.isCaptain).toBe(true);
      expect(player.parentalConsentStatus).toBe(ParentalConsentStatus.PENDING);

      // A working Season + active TeamSeasonPot exist, not a manual
      // follow-up step (ADR-0009 Decision 6).
      const pot = await dataSource.getRepository(TeamSeasonPot).findOneOrFail({
        where: { teamId: body.teamId, status: TeamSeasonPotStatus.ACTIVE },
      });
      expect(pot.pointsTotal).toBe(0);
      expect(pot.goalThreshold).toBe(5000);

      const season = await dataSource
        .getRepository(Season)
        .findOneOrFail({ where: { id: pot.seasonId } });
      expect(season.label).toMatch(/^(Vår|Höst) \d{4}$/);
      expect(season.startDate <= season.endDate).toBe(true);

      // The invite code they typed is the team's permanent one — not
      // regenerated (ADR-0009 Decision 3).
      const previewResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/invite/${inviteCode}`)
        .expect(200);
      expect((previewResponse.body as { teamId: string }).teamId).toBe(
        body.teamId,
      );
    });

    it('rejects a team name that fails the shared content-safety filter with 422, persisting nothing', async () => {
      const inviteCode = uniqueInviteCode('BAD');

      const response = await postPlayers({
        inviteCode,
        teamName: 'Idiot-laget', // "idiot" is in the shared wordlist
        screenName: uniqueScreenName('BadName'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'bad-name-parent@example.com',
      }).expect(422);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'team_name_rejected_by_filter',
      );

      const team = await dataSource
        .getRepository(Team)
        .findOne({ where: { inviteCode } });
      expect(team).toBeNull();
    });

    it("rejects an invite code that itself fails the content-safety filter with 422 (ACTION_PLAN.md's Phase 2.9 decision to check both fields)", async () => {
      // "idiot" embedded in the invite code, not just the name. Suffixed
      // with digits, not hex letters (unlike a raw randomUUID slice) — the
      // filter's word-boundary check (keyword-match.util.ts) requires the
      // banned word not be directly adjacent to another *letter*, so a
      // letter suffix would make this flaky (matches only when the random
      // suffix happens to start with a digit).
      const inviteCode = `IDIOT${Math.floor(100000 + Math.random() * 900000)}`;

      const response = await postPlayers({
        inviteCode,
        teamName: 'A Perfectly Fine Name',
        screenName: uniqueScreenName('BadCode'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'bad-code-parent@example.com',
      }).expect(422);

      expect((response.body as ApiErrorBody).error.code).toBe(
        'team_name_rejected_by_filter',
      );

      const team = await dataSource
        .getRepository(Team)
        .findOne({ where: { inviteCode } });
      expect(team).toBeNull();
    });

    it('a freshly self-created captain (own consent still pending) is blocked from captain-gated actions with 403 captain_consent_required, and can act once approved', async () => {
      const inviteCode = uniqueInviteCode('PEND');

      const createResponse = await postPlayers({
        inviteCode,
        teamName: 'Pending Consent Captains',
        screenName: uniqueScreenName('PendingCaptain'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'pending-captain-parent@example.com',
      }).expect(201);
      const { teamId, playerId, sessionToken } =
        createResponse.body as CreatePlayerBody;

      // Blocked: isCaptain is true, but this captain's own consent is
      // still pending — docs/ACTION_PLAN.md's Phase 2.9 decision.
      const blockedResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${sessionToken}`)
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
      expect((blockedResponse.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );

      const blockedRosterResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(403);
      expect((blockedRosterResponse.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );

      // Approve consent out-of-band (mirrors phase1.e2e-spec.ts's pattern —
      // there is no POST /consent/:token in this app's JSON contract).
      await dataSource
        .getRepository(Player)
        .update(
          { id: playerId },
          { parentalConsentStatus: ParentalConsentStatus.APPROVED },
        );

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/weekly-goal`)
        .set('Authorization', `Bearer ${sessionToken}`)
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
    });
  });

  describe('Ordinary join is unaffected', () => {
    it('teamName absent still 404s exactly as before when the code matches nothing', async () => {
      const response = await postPlayers({
        inviteCode: uniqueInviteCode('NOTEAM'),
        screenName: uniqueScreenName('NoTeam'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'no-team-parent@example.com',
      }).expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'invite_code_not_found',
      );
    });

    it('teamName present but inviteCode matches an existing team: joins that team, teamName is silently ignored, teamCreated/isCaptain are both false', async () => {
      const { teamId, inviteCode } = await createExistingTeamFixture();

      const response = await postPlayers({
        inviteCode,
        teamName: 'Some Other Name I Made Up',
        screenName: uniqueScreenName('Joiner'),
        avatarId: 'wolf',
        birthYear: 2014,
        parentContact: 'joiner-parent@example.com',
      }).expect(201);

      const body = response.body as CreatePlayerBody;
      expect(body.teamId).toBe(teamId);
      expect(body.teamName).toBe('Pre-existing Team');
      expect(body.teamCreated).toBe(false);
      expect(body.isCaptain).toBe(false);

      const team = await dataSource
        .getRepository(Team)
        .findOneOrFail({ where: { id: teamId } });
      expect(team.name).toBe('Pre-existing Team'); // unchanged by the stray teamName

      const player = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: body.playerId } });
      expect(player.isCaptain).toBe(false);
    });
  });

  describe('DTO validation', () => {
    it('rejects a teamName over 60 characters with a 400 validation error', async () => {
      const response = await postPlayers({
        inviteCode: uniqueInviteCode('LONG'),
        teamName: 'A'.repeat(61),
        screenName: uniqueScreenName('LongName'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'long-name-parent@example.com',
      }).expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('rejects an inviteCode over 30 characters with a 400 validation error', async () => {
      const response = await postPlayers({
        inviteCode: 'A'.repeat(31),
        teamName: 'Fine Name',
        screenName: uniqueScreenName('LongCode'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'long-code-parent@example.com',
      }).expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('rejects an empty-string teamName with a 400 validation error (not silently treated as absent)', async () => {
      const response = await postPlayers({
        inviteCode: uniqueInviteCode('EMPTY'),
        teamName: '',
        screenName: uniqueScreenName('EmptyName'),
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'empty-name-parent@example.com',
      }).expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });
  });
});
