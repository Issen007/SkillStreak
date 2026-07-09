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
import { Team } from '../src/teams/entities/team.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CaptainTransferBody {
  teamId: string;
  previousCaptainPlayerId: string;
  newCaptainPlayerId: string;
  transferredAt: string;
}

interface TeammatesBody {
  teammates: Array<{
    playerId: string;
    screenName: string;
    avatarId: string;
    isCaptain: boolean;
  }>;
}

// Exercises docs/adr/0006-captain-transfer.md /
// docs/api/phase2-contract.md's 2026-07-08 addendum end-to-end against
// real Postgres + Redis, mirroring phase2.e2e-spec.ts's fixture-creation
// conventions (a fresh Team/Season/TeamSeasonPot + directly-created players
// per test, bypassing the throttled POST /players onboarding endpoint).
describe('Fas 2.6a: captain transfer + teammates (e2e)', () => {
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

  async function createTeamFixture() {
    const inviteCode = `CT${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Captain Transfer Test Team', inviteCode }),
      );
    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId: team.id,
        label: 'CT Season',
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

  /** `consentStatus` defaults to approved (every existing caller's implicit
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
        isCaptain: true,
      }),
    );
    const sessionToken = playerTokenService.issueFor(
      player.id,
      player.tokenVersion,
    );
    return { playerId: player.id, sessionToken };
  }

  async function createTeamMember(teamId: string) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Member${randomUUID().slice(0, 6)}`,
        avatarId: 'wolf',
        birthYear: 2013,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
      }),
    );
    const sessionToken = playerTokenService.issueFor(
      player.id,
      player.tokenVersion,
    );
    return { playerId: player.id, sessionToken };
  }

  describe('POST /captain-transfer', () => {
    it('transfers captaincy: the requester loses is_captain, the target gains it, and the ex-captain immediately loses captain-gated access', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createCaptain(teamId);
      const { playerId: targetId, sessionToken: targetToken } =
        await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: targetId })
        .expect(200);

      const body = response.body as CaptainTransferBody;
      expect(body).toMatchObject({
        teamId,
        previousCaptainPlayerId: captainId,
        newCaptainPlayerId: targetId,
      });
      expect(typeof body.transferredAt).toBe('string');

      const requesterRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: captainId } });
      const targetRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: targetId } });
      expect(requesterRow.isCaptain).toBe(false);
      expect(targetRow.isCaptain).toBe(true);

      // The ex-captain immediately loses access to a captain-gated action
      // (roster) — the flag is re-checked per request, never cached
      // (ADR-0006's Consequences / the contract's security-reviewer note).
      const exCaptainRoster = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(403);
      expect((exCaptainRoster.body as ApiErrorBody).error.code).toBe(
        'not_team_captain',
      );

      // The new captain can now use a captain-gated action.
      await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${targetToken}`)
        .expect(200);
    });

    it('rejects a non-captain attempting a transfer with 403 not_team_captain', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { playerId: memberAId, sessionToken: memberAToken } =
        await createTeamMember(teamId);
      const { playerId: memberBId } = await createTeamMember(teamId);
      void captainToken;
      void memberAId;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${memberAToken}`)
        .send({ newCaptainPlayerId: memberBId })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'not_team_captain',
      );
    });

    it('rejects a captain of a different team with 403 team_mismatch', async () => {
      const { teamId: otherTeamId } = await createTeamFixture();
      const { sessionToken: otherCaptainToken } =
        await createCaptain(otherTeamId);
      const { teamId } = await createTeamFixture();
      const { playerId: targetId } = await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${otherCaptainToken}`)
        .send({ newCaptainPlayerId: targetId })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe('team_mismatch');
    });

    it('rejects a captain "transferring" to themselves with 409 captain_transfer_target_is_self', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createCaptain(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: captainId })
        .expect(409);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_transfer_target_is_self',
      );
    });

    it('rejects a target that exists but belongs to a different team with 403 captain_transfer_target_not_on_team', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);
      const { teamId: otherTeamId } = await createTeamFixture();
      const { playerId: outsiderId } = await createTeamMember(otherTeamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: outsiderId })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_transfer_target_not_on_team',
      );
    });

    it('rejects a nonexistent target with 404 player_not_found', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: randomUUID() })
        .expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'player_not_found',
      );
    });

    it('rejects a malformed newCaptainPlayerId with a 400 validation error', async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: captainToken } = await createCaptain(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: 'not-a-uuid' })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it("rejects a captain whose own consent is still pending with 403 captain_consent_required (docs/ACTION_PLAN.md's Phase 2.9 decision — checked before the self-transfer/target checks)", async () => {
      const { teamId } = await createTeamFixture();
      const { sessionToken: pendingCaptainToken } = await createCaptain(
        teamId,
        ParentalConsentStatus.PENDING,
      );
      const { playerId: targetId } = await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${pendingCaptainToken}`)
        .send({ newCaptainPlayerId: targetId })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'captain_consent_required',
      );

      // Never partially applied: the target never gained captaincy.
      const targetRow = await dataSource
        .getRepository(Player)
        .findOneOrFail({ where: { id: targetId } });
      expect(targetRow.isCaptain).toBe(false);
    });
  });

  describe('GET /teammates', () => {
    it('is open to any teammate (not captain-gated) and returns only playerId/screenName/avatarId/isCaptain', async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createCaptain(teamId);
      const { sessionToken: memberToken } = await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/teammates`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      const body = response.body as TeammatesBody;
      expect(body.teammates.length).toBeGreaterThanOrEqual(2);
      const captainEntry = body.teammates.find((t) => t.playerId === captainId);
      expect(captainEntry?.isCaptain).toBe(true);
      const raw = JSON.stringify(body);
      expect(raw).not.toMatch(
        /consentStatus|lastTrainedDate|realName|parentContact/i,
      );

      // The captain can call it too (no gate either way).
      await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/teammates`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);
    });

    it('rejects a player from a different team with 403 team_mismatch', async () => {
      const { teamId: otherTeamId } = await createTeamFixture();
      const { sessionToken: outsiderToken } =
        await createTeamMember(otherTeamId);
      const { teamId } = await createTeamFixture();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/teammates`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe('team_mismatch');
    });
  });

  describe('GET /roster — additive isCaptain field (ADR-0006 Decision 2)', () => {
    it("includes isCaptain: true/false per entry, matching each player's actual flag", async () => {
      const { teamId } = await createTeamFixture();
      const { playerId: captainId, sessionToken: captainToken } =
        await createCaptain(teamId);
      const { playerId: memberId } = await createTeamMember(teamId);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/roster`)
        .set('Authorization', `Bearer ${captainToken}`)
        .expect(200);

      const players = (
        response.body as {
          players: Array<{ playerId: string; isCaptain: boolean }>;
        }
      ).players;
      expect(players.find((p) => p.playerId === captainId)?.isCaptain).toBe(
        true,
      );
      expect(players.find((p) => p.playerId === memberId)?.isCaptain).toBe(
        false,
      );
    });
  });
});
