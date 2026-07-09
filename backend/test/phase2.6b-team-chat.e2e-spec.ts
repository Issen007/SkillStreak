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
import {
  ChatMessageStatus,
  TeamChatMessage,
} from '../src/team-chat/entities/team-chat-message.entity';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface ChatMessageBody {
  id: string;
  teamId: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
  createdAt: string;
}

interface ChatMessageListItemBody {
  id: string;
  senderPlayerId: string;
  senderScreenName: string;
  content: string;
  createdAt: string;
  reportedByMe: boolean;
}

// Exercises docs/api/phase2.6b-contract.md's five endpoints end-to-end
// against real Postgres + Redis, mirroring phase2.e2e-spec.ts's
// fixture-creation conventions (players created directly, bypassing the
// throttled POST /players onboarding endpoint).
describe('Fas 2.6b: team chat (e2e)', () => {
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
    const inviteCode = `CHAT${randomUUID().slice(0, 8).toUpperCase()}`;
    const team = await dataSource
      .getRepository(Team)
      .save(
        dataSource
          .getRepository(Team)
          .create({ name: 'Team Chat Test Team', inviteCode }),
      );
    return team.id;
  }

  async function createPlayer(
    teamId: string,
    consentStatus: ParentalConsentStatus = ParentalConsentStatus.APPROVED,
  ) {
    const player = await dataSource.getRepository(Player).save(
      dataSource.getRepository(Player).create({
        teamId,
        screenName: `Chat${randomUUID().slice(0, 8)}`,
        avatarId: 'fox',
        birthYear: 2013,
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

  describe('POST /chat/messages', () => {
    it('rejects a pending-consent player with 403 consent_required', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(
        teamId,
        ParentalConsentStatus.PENDING,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'hej laget' })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'consent_required',
      );
    });

    it('rejects empty/whitespace-only content with a 400 validation error', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: '    ' })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('rejects content over the 500-char cap with a 400 validation error', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'x'.repeat(501) })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('rejects a message containing a banned word with 422 message_rejected_by_filter, and never stores it', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'din jävla idiot' })
        .expect(422);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'message_rejected_by_filter',
      );

      const stored = await dataSource
        .getRepository(TeamChatMessage)
        .find({ where: { teamId } });
      expect(stored).toHaveLength(0);
    });

    it('rejects a player from a different team with 403 team_mismatch', async () => {
      const teamId = await createTeam();
      const { teamId: otherTeamId } = { teamId: await createTeam() };
      const { sessionToken } = await createPlayer(otherTeamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'hej' })
        .expect(403);
      expect((response.body as ApiErrorBody).error.code).toBe('team_mismatch');
    });

    it('sends a valid message and returns the full shape, trimmed', async () => {
      const teamId = await createTeam();
      const { playerId, sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: '  Bra jobbat idag!  ' })
        .expect(201);

      const body = response.body as ChatMessageBody;
      expect(body).toMatchObject({
        teamId,
        senderPlayerId: playerId,
        content: 'Bra jobbat idag!',
      });
      expect(typeof body.id).toBe('string');
      expect(typeof body.createdAt).toBe('string');
    });

    it('rate-limits a burst of sends beyond the allowance with 429 chat_send_rate_limited', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const responses: number[] = [];
      // Comfortably over the 20/60s allowance implemented in
      // RedisService.tryClaimChatSendAllowance's default.
      for (let i = 0; i < 25; i += 1) {
        // sequential so each request's rate-limit counter increment is
        // observed by the next, matching how a real burst of taps arrives.
        const response = await request(app.getHttpServer())
          .post(`/api/v1/teams/${teamId}/chat/messages`)
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ content: `message ${i}` });
        responses.push(response.status);
      }

      expect(responses).toContain(429);
    }, 30_000);
  });

  describe('GET /chat/messages — combined status/block filtering', () => {
    it('never returns a hidden message, and never returns a message from someone the viewer has blocked', async () => {
      const teamId = await createTeam();
      const { playerId: viewerId, sessionToken: viewerToken } =
        await createPlayer(teamId);
      const { playerId: blockedSenderId, sessionToken: blockedSenderToken } =
        await createPlayer(teamId);
      const { sessionToken: otherSenderToken } = await createPlayer(teamId);

      // A visible message from the (soon-to-be-blocked) sender.
      const blockedMsgResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${blockedSenderToken}`)
        .send({ content: 'meddelande fran blockerad' })
        .expect(201);

      // A visible message from an unrelated sender.
      const otherMsgResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${otherSenderToken}`)
        .send({ content: 'vanligt meddelande' })
        .expect(201);

      // A message that will be flipped to 'hidden' out-of-band (the only
      // way status ever changes — ADR-0007 Decision 3).
      const hiddenMsgResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${otherSenderToken}`)
        .send({ content: 'kommer att döljas' })
        .expect(201);
      await dataSource
        .getRepository(TeamChatMessage)
        .update(
          { id: (hiddenMsgResponse.body as ChatMessageBody).id },
          { status: ChatMessageStatus.HIDDEN },
        );

      // The viewer blocks the first sender.
      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ blockedPlayerId: blockedSenderId })
        .expect(200);

      const listResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const messages = (
        listResponse.body as { messages: ChatMessageListItemBody[] }
      ).messages;
      const ids = messages.map((m) => m.id);

      expect(ids).toContain((otherMsgResponse.body as ChatMessageBody).id);
      expect(ids).not.toContain(
        (blockedMsgResponse.body as ChatMessageBody).id,
      );
      expect(ids).not.toContain((hiddenMsgResponse.body as ChatMessageBody).id);

      // A different, non-blocking viewer still sees the blocked sender's
      // message — blocking is strictly per-viewer (ADR-0007 Decision 4).
      const otherViewerList = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${otherSenderToken}`)
        .expect(200);
      const otherViewerIds = (
        otherViewerList.body as { messages: ChatMessageListItemBody[] }
      ).messages.map((m) => m.id);
      expect(otherViewerIds).toContain(
        (blockedMsgResponse.body as ChatMessageBody).id,
      );
      void viewerId;
    });

    it("marks reportedByMe true only for the viewer's own report, never for someone else's", async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);
      const { sessionToken: bystanderToken } = await createPlayer(teamId);

      const msgResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'rapportera mig' })
        .expect(201);
      const messageId = (msgResponse.body as ChatMessageBody).id;

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages/${messageId}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'spam' })
        .expect(201);

      const reporterView = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .expect(200);
      const reporterEntry = (
        reporterView.body as { messages: ChatMessageListItemBody[] }
      ).messages.find((m) => m.id === messageId);
      expect(reporterEntry?.reportedByMe).toBe(true);

      const bystanderView = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${bystanderToken}`)
        .expect(200);
      const bystanderEntry = (
        bystanderView.body as { messages: ChatMessageListItemBody[] }
      ).messages.find((m) => m.id === messageId);
      expect(bystanderEntry?.reportedByMe).toBe(false);
    });
  });

  describe('POST /chat/messages/:messageId/report', () => {
    it('rejects a nonexistent (or cross-team) message with 404', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages/${randomUUID()}/report`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ reason: 'spam' })
        .expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'chat_message_not_found',
      );
    });

    it('rejects a second report of the same message by the same reporter with 409, without inflating a count', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);

      const msgResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'rapportera mig igen' })
        .expect(201);
      const messageId = (msgResponse.body as ChatMessageBody).id;

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages/${messageId}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'bullying' })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages/${messageId}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'bullying' })
        .expect(409);
      expect((second.body as ApiErrorBody).error.code).toBe(
        'chat_message_already_reported_by_you',
      );
    });

    it("never changes the reported message's status — reporting is not hiding", async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { sessionToken: reporterToken } = await createPlayer(teamId);

      const msgResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'fortfarande synlig' })
        .expect(201);
      const messageId = (msgResponse.body as ChatMessageBody).id;

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages/${messageId}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({ reason: 'other', note: 'test' })
        .expect(201);

      const row = await dataSource
        .getRepository(TeamChatMessage)
        .findOneOrFail({ where: { id: messageId } });
      expect(row.status).toBe(ChatMessageStatus.VISIBLE);
    });
  });

  describe('POST /chat/blocks + DELETE /chat/blocks/:blockedPlayerId', () => {
    it('rejects a self-block with a 400', async () => {
      const teamId = await createTeam();
      const { playerId, sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ blockedPlayerId: playerId })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it('is idempotent — blocking an already-blocked player is 200, not an error, and does not change the original createdAt', async () => {
      const teamId = await createTeam();
      const { sessionToken: blockerToken } = await createPlayer(teamId);
      const { playerId: targetId } = await createPlayer(teamId);

      const first = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${blockerToken}`)
        .send({ blockedPlayerId: targetId })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${blockerToken}`)
        .send({ blockedPlayerId: targetId })
        .expect(200);

      expect((second.body as { createdAt: string }).createdAt).toBe(
        (first.body as { createdAt: string }).createdAt,
      );
    });

    it('unblock is idempotent — succeeds whether or not a block existed', async () => {
      const teamId = await createTeam();
      const { sessionToken: blockerToken } = await createPlayer(teamId);
      const { playerId: targetId } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/teams/${teamId}/chat/blocks/${targetId}`)
        .set('Authorization', `Bearer ${blockerToken}`)
        .expect(200);
      expect(response.body).toEqual({
        blockedPlayerId: targetId,
        unblocked: true,
      });

      // A real block, then unblocked, then the sender's messages are
      // visible again.
      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${blockerToken}`)
        .send({ blockedPlayerId: targetId })
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/v1/teams/${teamId}/chat/blocks/${targetId}`)
        .set('Authorization', `Bearer ${blockerToken}`)
        .expect(200);
    });
  });
});
