import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
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

interface LeaderboardEntryBody {
  rank: number;
  teamId: string;
  teamName: string;
  pointsTotal: number;
  isRequestingTeam: boolean;
}

interface LeaderboardBody {
  requestingTeam: {
    teamId: string;
    teamName: string;
    pointsTotal: number;
    rank: number;
  } | null;
  leaderboard: LeaderboardEntryBody[];
}

// docs/adr/0008-vm-guld-cross-team-leaderboard.md's leaderboard is
// genuinely cross-team/global by design — this suite shares Postgres with
// every other e2e fixture team ever created (this project's e2e suites
// don't universally clean up their fixture teams). So every assertion
// below is deliberately either (a) a RELATIVE comparison among this
// suite's own fixture teams, using astronomically large, randomly-offset
// point totals so no other suite's fixtures can plausibly land between
// them, or (b) a structural check (e.g. "my own team's row is present with
// the right name/points") — never an assertion about the *absolute*
// rank/teamCount of the whole system, which this suite has no way to
// control.
describe('Fas 2.7: cross-team leaderboard (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let playerTokenService: PlayerTokenService;
  // The leaderboard is genuinely global/cross-team, so — unlike most other
  // e2e suites in this project, which leave their fixture teams in place —
  // this suite cleans up every team it creates (see afterAll below).
  // Leftover huge-point-total teams from a previous *run* of this exact
  // suite would otherwise accumulate across repeated local dev-loop runs
  // and eventually collide with a later run's own "well-separated" values,
  // defeating the whole point of this suite's determinism strategy.
  const createdTeamIds: string[] = [];

  // A random, very large base so concurrent/prior runs of this same suite
  // (or any other suite's ordinary-sized fixtures) can't coincidentally
  // collide with these values.
  // Postgres `integer` tops out just over 2.1 billion, so this stays
  // comfortably below that while still being large (and randomly offset)
  // enough that no other suite's ordinary-sized fixtures (a few thousand
  // points, at most) can land between these values.
  const BASE_POINTS = 1_000_000_000 + Math.floor(Math.random() * 500_000_000);

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
    if (createdTeamIds.length > 0) {
      // ON DELETE CASCADE removes each team's season/pot rows too.
      await dataSource.getRepository(Team).delete({ id: In(createdTeamIds) });
    }
    await app.close();
  });

  async function createTeamWithPot(
    teamName: string,
    pointsTotal: number | null,
  ) {
    const inviteCode = `LB${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource.getRepository(Team).create({ name: teamName, inviteCode }),
      );
    createdTeamIds.push(team.id);

    if (pointsTotal !== null) {
      const season = await dataSource.getRepository(Season).save(
        dataSource.getRepository(Season).create({
          teamId: team.id,
          label: 'Leaderboard Test Season',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      );
      await dataSource.getRepository(TeamSeasonPot).save(
        dataSource.getRepository(TeamSeasonPot).create({
          teamId: team.id,
          seasonId: season.id,
          pointsTotal,
          goalThreshold: 999_999_999,
          status: TeamSeasonPotStatus.ACTIVE,
        }),
      );
    }
    return team.id;
  }

  async function createPlayer(teamId: string) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `LB${randomUUID().slice(0, 8)}`,
        avatarId: 'fox',
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

  it('assigns standard competition ranks (ties share rank, the next distinct score skips) among a controlled set of teams', async () => {
    const teamATop = await createTeamWithPot('LB Team Top A', BASE_POINTS);
    const teamBTop = await createTeamWithPot('LB Team Top B', BASE_POINTS); // tied with A
    const teamCBelow = await createTeamWithPot(
      'LB Team Below',
      BASE_POINTS - 800_000_000, // far enough below to avoid any other
      // fixture landing strictly between BASE_POINTS and this value.
    );

    const { sessionToken } = await createPlayer(teamATop);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamATop}/leaderboard`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);

    const body = response.body as LeaderboardBody;
    const byId = new Map(body.leaderboard.map((row) => [row.teamId, row]));

    const rowA = byId.get(teamATop);
    const rowB = byId.get(teamBTop);
    const rowC = byId.get(teamCBelow);
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowC).toBeDefined();

    // Ties share the same rank.
    expect(rowA?.rank).toBe(rowB?.rank);
    // The lower-scored team ranks strictly worse (a larger rank number).
    expect(rowC!.rank).toBeGreaterThan(rowA!.rank);
    // Standard competition ranking's skip: with exactly two teams tied
    // immediately above it (and nothing else between, guaranteed by the
    // 1-billion-point gap), the next distinct score skips by 2, not 1.
    expect(rowC!.rank).toBe(rowA!.rank + 2);

    // requestingTeam matches the corresponding leaderboard row exactly.
    expect(body.requestingTeam).toEqual({
      teamId: teamATop,
      teamName: 'LB Team Top A',
      pointsTotal: BASE_POINTS,
      rank: rowA!.rank,
    });

    // No player-level data anywhere in the response, for any team.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(
      /screenName|avatarId|consentStatus|realName|parentContact/i,
    );
  });

  it("omits a team with no active pot entirely (not shown at zero), and returns requestingTeam: null for that team's own view", async () => {
    const teamWithoutPot = await createTeamWithPot('LB Team Without Pot', null);
    const { sessionToken } = await createPlayer(teamWithoutPot);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamWithoutPot}/leaderboard`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);

    const body = response.body as LeaderboardBody;
    expect(body.requestingTeam).toBeNull();
    expect(body.leaderboard.some((row) => row.teamId === teamWithoutPot)).toBe(
      false,
    );
  });

  it('rejects a player from a different team with 403 team_mismatch', async () => {
    const teamId = await createTeamWithPot('LB Team Mismatch', BASE_POINTS);
    const otherTeamId = await createTeamWithPot(
      'LB Team Mismatch Other',
      BASE_POINTS,
    );
    const { sessionToken } = await createPlayer(otherTeamId);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamId}/leaderboard`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(403);
    expect((response.body as ApiErrorBody).error.code).toBe('team_mismatch');
  });

  it('dashboard and GET /players/me report the same rank as the leaderboard endpoint for the same team, and never include goalThreshold/percentComplete', async () => {
    // NOTE on why this doesn't also assert exact `teamCount` equality
    // across the three calls below: `teamCount` is the *total* number of
    // teams with any active pot, system-wide — genuinely live state that
    // sibling e2e spec files (running concurrently, against the same
    // shared Postgres, per this project's e2e setup) can and do change
    // between one HTTP round-trip and the next by creating their own
    // Team+Season+TeamSeasonPot fixtures. `rank`, in contrast, is stable
    // for *this* test's team across those same three calls, because rank
    // only changes if a team with a *strictly greater* pointsTotal appears
    // or disappears — and BASE_POINTS is deliberately ~1 billion+, orders
    // of magnitude above what any other suite's ordinary fixtures ever use
    // (a handful to a few hundred points), so no sibling suite can ever
    // produce a competing top score. Each response's own internal
    // consistency (1 <= rank <= teamCount) is still checked individually.
    const teamId = await createTeamWithPot('LB Team Cross-Check', BASE_POINTS);
    const { sessionToken } = await createPlayer(teamId);

    const leaderboardResponse = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamId}/leaderboard`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const leaderboardBody = leaderboardResponse.body as LeaderboardBody;
    const expectedRank = leaderboardBody.requestingTeam?.rank;
    expect(expectedRank).toBeDefined();
    expect(expectedRank).toBeLessThanOrEqual(
      leaderboardBody.leaderboard.length,
    );

    const meResponse = await request(app.getHttpServer())
      .get('/api/v1/players/me')
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const meTeamPool = (
      meResponse.body as {
        teamPool: {
          rank: number;
          teamCount: number;
          goalThreshold?: number;
          percentComplete?: number;
        };
      }
    ).teamPool;
    expect(meTeamPool.rank).toBe(expectedRank);
    expect(meTeamPool.rank).toBeLessThanOrEqual(meTeamPool.teamCount);
    expect(meTeamPool.goalThreshold).toBeUndefined();
    expect(meTeamPool.percentComplete).toBeUndefined();

    const dashboardResponse = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamId}/dashboard`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    const dashboardTeamPool = (
      dashboardResponse.body as {
        teamPool: {
          rank: number;
          teamCount: number;
          goalThreshold?: number;
          percentComplete?: number;
        };
      }
    ).teamPool;
    expect(dashboardTeamPool.rank).toBe(expectedRank);
    expect(dashboardTeamPool.rank).toBeLessThanOrEqual(
      dashboardTeamPool.teamCount,
    );
    expect(dashboardTeamPool.goalThreshold).toBeUndefined();
    expect(dashboardTeamPool.percentComplete).toBeUndefined();
  });

  it("POST /training-logs' teamPool block has only pointsTotal — no goalThreshold/percentComplete/rank", async () => {
    const teamId = await createTeamWithPot('LB Team Training Log', BASE_POINTS);
    const { sessionToken } = await createPlayer(teamId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/training-logs')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ activityType: 'fitness', durationMinutes: 15 })
      .expect(201);

    const teamPool = (response.body as { teamPool: Record<string, unknown> })
      .teamPool;
    expect(Object.keys(teamPool).sort()).toEqual(['pointsTotal']);
  });
});
