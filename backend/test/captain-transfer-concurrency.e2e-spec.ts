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

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CaptainTransferBody {
  teamId: string;
  previousCaptainPlayerId: string;
  newCaptainPlayerId: string;
}

// Regression coverage for docs/adr/0006-captain-transfer.md's "Transaction
// shape — no window with zero or two captains" section, mirroring how
// test/training-logs-concurrency.e2e-spec.ts already covers the analogous
// row-lock/idempotency race for training logs.
//
// The ADR's own framing: the only way two transferCaptaincy calls can race
// at all is two calls from the *same* current captain (e.g. a double-tap
// targeting two different teammates) — both lock the requester's own row
// first (fixed lock order), so they serialize on that lock rather than
// deadlocking. Whichever call loses that race re-reads `requester.
// isCaptain` under its own lock *after* the winner has already committed
// and cleared it, and fails with `not_team_captain` — not a unique-index
// conflict, since the loser never even reaches the target-row/unique-index
// territory once its own captain check fails.
describe('Captain-transfer concurrency (e2e)', () => {
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
    const inviteCode = `CTC${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Captain Transfer Concurrency Team', inviteCode }),
      );
    return team.id;
  }

  async function createPlayer(
    teamId: string,
    isCaptain: boolean,
  ): Promise<{ playerId: string; sessionToken: string }> {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `CTC${randomUUID().slice(0, 8)}`,
        avatarId: 'fox',
        birthYear: 2012,
        parentalConsentStatus: ParentalConsentStatus.APPROVED,
        isCaptain,
      }),
    );
    const sessionToken = playerTokenService.issueFor(
      player.id,
      player.tokenVersion,
    );
    return { playerId: player.id, sessionToken };
  }

  it('a double-tap transfer to two different teammates from the same captain: exactly one succeeds, the other fails with not_team_captain, and exactly one player ends up captain', async () => {
    const teamId = await createTeam();
    const { playerId: captainId, sessionToken: captainToken } =
      await createPlayer(teamId, true);
    const { playerId: targetAId } = await createPlayer(teamId, false);
    const { playerId: targetBId } = await createPlayer(teamId, false);

    // Fire both transfer attempts essentially simultaneously, from the same
    // captain, targeting two different teammates — the exact race ADR-0006
    // designs the fixed lock order/re-check around.
    const [responseA, responseB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: targetAId }),
      request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/captain-transfer`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({ newCaptainPlayerId: targetBId }),
    ]);

    const responses = [responseA, responseB];
    const succeeded = responses.filter((r) => r.status === 200);
    const failed = responses.filter((r) => r.status !== 200);

    // Exactly one call wins the race; the loser fails outright rather than
    // silently no-op-ing or both succeeding (which would imply a moment
    // with two captains, or the requester "transferring" a role it no
    // longer had).
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // The loser's failure is specifically not_team_captain (403) — the
    // requester's own row-locked re-check catching a captaincy that's
    // already gone — never captain_transfer_conflict (409, the unique-
    // index backstop), since this race never reaches that code path.
    expect((failed[0].body as ApiErrorBody).error.code).toBe(
      'not_team_captain',
    );

    const winnerBody = succeeded[0].body as CaptainTransferBody;
    expect(winnerBody.previousCaptainPlayerId).toBe(captainId);
    expect([targetAId, targetBId]).toContain(winnerBody.newCaptainPlayerId);

    // Durable state after the race: exactly one captain on the team, and
    // it's whichever target won — never zero, never two.
    const players = await dataSource
      .getRepository(Player)
      .find({ where: { teamId } });
    const captains = players.filter((p) => p.isCaptain);
    expect(captains).toHaveLength(1);
    expect(captains[0].id).toBe(winnerBody.newCaptainPlayerId);

    const exCaptainRow = players.find((p) => p.id === captainId);
    expect(exCaptainRow?.isCaptain).toBe(false);
  });
});
