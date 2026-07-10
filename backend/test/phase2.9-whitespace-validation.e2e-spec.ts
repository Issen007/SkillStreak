import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppExceptionFilter } from '../src/common/errors/http-exception.filter';
import { Team } from '../src/teams/entities/team.entity';

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

// Split out from phase2.9-self-service-team-creation.e2e-spec.ts, which
// already sits at that file's shared-app-instance POST /players throttle
// limit (@Throttle({ limit: 10, ttl: 60_000 }) on the route) — a fresh app
// instance here gets a fresh in-memory throttle bucket.
//
// Regression coverage for a code-critic finding: class-validator's
// IsNotEmpty only rejects the exact empty string, not a whitespace-only
// one, so " " on inviteCode/teamName used to pass validation and the
// content-safety filter (which trivially "passes" a string with no banned
// word) and get permanently persisted as a blank Team.name/invite_code —
// this app has no team rename/delete feature. Fixed via a trimming
// @Transform in create-player.dto.ts, matching the existing convention in
// team-chat/dto/create-chat-message.dto.ts.
describe('Fas 2.9: whitespace-only inviteCode/teamName validation (e2e)', () => {
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

  function postPlayers(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/players').send(body);
  }

  it('rejects a whitespace-only teamName with a 400 validation error, persisting no team', async () => {
    const inviteCode = uniqueInviteCode('WSNAME');

    const response = await postPlayers({
      inviteCode,
      teamName: '   ',
      screenName: uniqueScreenName('WsName'),
      avatarId: 'fox',
      birthYear: 2014,
      parentContact: 'ws-name-parent@example.com',
    }).expect(400);
    expect((response.body as ApiErrorBody).error.code).toBe('validation_error');

    const team = await dataSource
      .getRepository(Team)
      .findOne({ where: { inviteCode } });
    expect(team).toBeNull();
  });

  it('rejects a whitespace-only inviteCode with a 400 validation error', async () => {
    const response = await postPlayers({
      inviteCode: '   ',
      teamName: 'Fine Name',
      screenName: uniqueScreenName('WsCode'),
      avatarId: 'fox',
      birthYear: 2014,
      parentContact: 'ws-code-parent@example.com',
    }).expect(400);
    expect((response.body as ApiErrorBody).error.code).toBe('validation_error');
  });

  it('trims leading/trailing whitespace from a legitimate teamName/inviteCode before persisting', async () => {
    const rawInviteCode = `  ${uniqueInviteCode('TRIM')}  `;

    const response = await postPlayers({
      inviteCode: rawInviteCode,
      teamName: '  Trimmed Team  ',
      screenName: uniqueScreenName('Trim'),
      avatarId: 'fox',
      birthYear: 2014,
      parentContact: 'trim-parent@example.com',
    }).expect(201);

    const body = response.body as CreatePlayerBody;
    expect(body.teamName).toBe('Trimmed Team');

    const team = await dataSource
      .getRepository(Team)
      .findOneOrFail({ where: { id: body.teamId } });
    expect(team.name).toBe('Trimmed Team');
    expect(team.inviteCode).toBe(rawInviteCode.trim());
  });
});
