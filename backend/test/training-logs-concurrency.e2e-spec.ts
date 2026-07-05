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
import { Team } from '../src/teams/entities/team.entity';
import { Season } from '../src/team-pool/entities/season.entity';
import { TeamSeasonPot } from '../src/team-pool/entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from '../src/team-pool/team-season-pot-status.enum';

interface CreatePlayerBody {
  playerId: string;
  sessionToken: string;
}

interface TrainingLogBody {
  streak: {
    currentStreakCount: number;
    longestStreakCount: number;
    alreadyLoggedToday: boolean;
  };
  teamPool: {
    pointsTotal: number;
  };
}

// Regression coverage for the double-tap-race / lost-update protection in
// TrainingLogsService (row-locked re-read + a single Postgres transaction
// per request — see training-logs.service.ts's comments). code-critic
// verified this manually against real Postgres during Phase 1 review; this
// test exists so a future refactor that reintroduces the race fails CI
// instead of shipping green.
//
// Requires the same real Postgres/Redis (docker-compose) as phase1.e2e-spec.ts.
describe('Training-log concurrency (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let teamId: string;
  let inviteCode: string;

  const CONCURRENT_REQUEST_COUNT = 15;
  const DURATION_MINUTES = 10;

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

    inviteCode = `CONC${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Concurrency Test Team', inviteCode }),
      );
    teamId = team.id;

    const season = await dataSource.getRepository(Season).save(
      dataSource.getRepository(Season).create({
        teamId,
        label: 'Concurrency Season',
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

  it('collapses N concurrent same-day logs into exactly one streak increment while crediting every log to the team pool', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/players')
      .send({
        inviteCode,
        screenName: `ConcPlayer${randomUUID().slice(0, 6)}`,
        avatarId: 'fox',
        birthYear: 2014,
        parentContact: 'parent@example.com',
      })
      .expect(201);

    const { playerId, sessionToken } = createResponse.body as CreatePlayerBody;

    await dataSource
      .getRepository(Player)
      .update(
        { id: playerId },
        { parentalConsentStatus: ParentalConsentStatus.APPROVED },
      );

    // Fire every request essentially simultaneously — this is the scenario
    // the row-level lock in PlayersService.findByIdForUpdate exists to
    // serialize (the "double tap" case, generalized to N taps).
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUEST_COUNT }, () =>
        request(app.getHttpServer())
          .post('/api/v1/training-logs')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ activityType: 'fitness', durationMinutes: DURATION_MINUTES }),
      ),
    );

    // No request should fail or be dropped — every log is a legitimate
    // write (a player may log more than once per day per the contract's
    // same-day-logging rule), so all should succeed.
    for (const response of responses) {
      expect(response.status).toBe(201);
    }
    const bodies = responses.map((r) => r.body as TrainingLogBody);

    // Exactly one of the N concurrent requests should have "won" the
    // first-log-of-the-day transition; every other request — regardless of
    // arrival order — must observe alreadyLoggedToday: true. If the lock
    // were broken, more than one request could see alreadyLoggedToday:
    // false and double-increment the streak.
    const firstLogResponses = bodies.filter(
      (b) => b.streak.alreadyLoggedToday === false,
    );
    expect(firstLogResponses).toHaveLength(1);
    expect(firstLogResponses[0].streak.currentStreakCount).toBe(1);

    const alreadyLoggedResponses = bodies.filter(
      (b) => b.streak.alreadyLoggedToday === true,
    );
    expect(alreadyLoggedResponses).toHaveLength(CONCURRENT_REQUEST_COUNT - 1);
    for (const body of alreadyLoggedResponses) {
      expect(body.streak.currentStreakCount).toBe(1);
      expect(body.streak.longestStreakCount).toBe(1);
    }

    // Durable state after the storm: streak incremented exactly once...
    const player = await dataSource
      .getRepository(Player)
      .findOneOrFail({ where: { id: playerId } });
    expect(player.currentStreakCount).toBe(1);
    expect(player.longestStreakCount).toBe(1);

    // ...but every one of the N logs still landed in the team pool — no
    // lost updates from TeamPoolService's atomic increment.
    const expectedPoints = CONCURRENT_REQUEST_COUNT * DURATION_MINUTES;
    const highestReportedPoolTotal = Math.max(
      ...bodies.map((b) => b.teamPool.pointsTotal),
    );
    expect(highestReportedPoolTotal).toBe(expectedPoints);

    const pot = await dataSource
      .getRepository(TeamSeasonPot)
      .findOneOrFail({ where: { teamId } });
    expect(pot.pointsTotal).toBe(expectedPoints);
  });
});
