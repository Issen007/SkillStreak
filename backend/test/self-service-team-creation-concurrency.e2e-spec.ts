import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { Team } from '../src/teams/entities/team.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { Player } from '../src/players/entities/player.entity';
import { TeamsService } from '../src/teams/teams.service';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface CreatePlayerBody {
  playerId: string;
  teamId: string;
  teamName: string;
  teamCreated: boolean;
  isCaptain: boolean;
}

// Regression coverage for docs/adr/0009-self-service-team-creation.md
// Decision 8's "the invite-code creation race — an explicit error, not a
// silent fallback", mirroring how
// captain-transfer-concurrency.e2e-spec.ts already covers the analogous
// row-lock/idempotency race for captain transfer, and
// training-logs-concurrency.e2e-spec.ts for training logs.
//
// The only way two POST /players calls can race to create the *same* team
// is two independent onboarding sessions both seeing 404 for the identical
// not-yet-existing invite code and both attempting to create it — the
// unique constraint on team.invite_code (UQ_da387f0c2e17d1e1e09f2836adf)
// is what actually decides the winner; TeamsService.createTeam's INSERT is
// the only place that constraint can be hit via this feature.
describe('Self-service team creation — invite-code race (e2e)', () => {
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

  it('two concurrent onboarding requests racing to create a team with the identical invite code: exactly one succeeds, the other gets 409 invite_code_taken_concurrently, and exactly one team/season/pot/captain is ever persisted', async () => {
    const inviteCode = `RACE${randomUUID().slice(0, 8).toUpperCase()}`;

    // `Promise.all` alone doesn't force a genuine race here: it just fires
    // both requests without synchronizing them, so request A's entire
    // check-transaction-insert-commit can finish before request B's own
    // pre-transaction findByInviteCode check even runs — at which point B
    // correctly (and harmlessly) sees "team already exists" and joins it,
    // which isn't the DB-constraint race this test exists to cover. That
    // made this test flaky (~1-in-5 locally). Gate findByInviteCode so
    // neither call for this invite code can return until *both* have
    // arrived, guaranteeing both requests observe "doesn't exist yet" and
    // both attempt to create it — every run, deterministically.
    const teamsService: TeamsService = app.get(TeamsService);
    // Captured (bound) before jest.spyOn below overwrites the instance
    // property. `Function.prototype.bind`'s built-in TS typing collapses
    // to `any` for this method, hence the explicit cast back to the real
    // signature.
    const originalFindByInviteCode = teamsService.findByInviteCode.bind(
      teamsService,
    ) as (code: string, manager?: EntityManager) => Promise<Team | null>;
    let arrivals = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const spy = jest
      .spyOn(teamsService, 'findByInviteCode')
      .mockImplementation(async (code: string, manager?: EntityManager) => {
        if (code !== inviteCode) {
          return originalFindByInviteCode(code, manager);
        }
        // Do the actual read immediately (don't delay the query itself —
        // that's not the racy part), but withhold the *result* from the
        // caller until both reads have resolved. Gating only the call (an
        // earlier attempt) wasn't enough: DB round-trip time varies enough
        // (observed 13ms vs 178ms for two reads started 5ms apart, likely
        // connection-pool queueing) that the faster request could run its
        // entire transaction to commit before the slower one's read even
        // returned — by which point it correctly (but unhelpfully, for
        // this test) saw the already-created team instead of racing.
        const result = await originalFindByInviteCode(code, manager);
        arrivals += 1;
        if (arrivals >= 2) releaseGate();
        await gate;
        return result;
      });

    let responses: Array<{ status: number; body: unknown }>;
    try {
      responses = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/players')
          .send({
            inviteCode,
            teamName: 'Race Team A',
            screenName: `RaceA${randomUUID().slice(0, 6)}`,
            avatarId: 'fox',
            birthYear: 2014,
            parentContact: 'race-a-parent@example.com',
          }),
        request(app.getHttpServer())
          .post('/api/v1/players')
          .send({
            inviteCode,
            teamName: 'Race Team B',
            screenName: `RaceB${randomUUID().slice(0, 6)}`,
            avatarId: 'fox',
            birthYear: 2014,
            parentContact: 'race-b-parent@example.com',
          }),
      ]);
    } finally {
      spy.mockRestore();
    }

    const succeeded = responses.filter((r) => r.status === 201);
    const failed = responses.filter((r) => r.status !== 201);

    // Exactly one call wins the race; the loser fails outright rather than
    // silently falling back to joining the winner's team (ADR-0009
    // Decision 8 — rejected explicitly, not a "graceful" fallback).
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].body as ApiErrorBody).error.code).toBe(
      'invite_code_taken_concurrently',
    );
    expect(failed[0].status).toBe(409);

    const winnerBody = succeeded[0].body as CreatePlayerBody;
    expect(winnerBody.teamCreated).toBe(true);
    expect(winnerBody.isCaptain).toBe(true);
    expect(['Race Team A', 'Race Team B']).toContain(winnerBody.teamName);

    // Durable state after the race: exactly one team exists with this
    // invite code — never two, and the loser's attempted team/season/pot
    // never persisted (its whole transaction rolled back).
    const teams = await dataSource
      .getRepository(Team)
      .find({ where: { inviteCode } });
    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe(winnerBody.teamId);
    expect(teams[0].name).toBe(winnerBody.teamName);

    const pots = await dataSource
      .getRepository(TeamSeasonPot)
      .find({ where: { teamId: winnerBody.teamId } });
    expect(pots).toHaveLength(1);

    const players = await dataSource
      .getRepository(Player)
      .find({ where: { teamId: winnerBody.teamId } });
    expect(players).toHaveLength(1);
    expect(players[0].isCaptain).toBe(true);
  });
});
