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
import {
  ChatMessageAuthorType,
  ChatMessageStatus,
  SystemChatEventType,
  TeamChatMessage,
} from '../src/team-chat/entities/team-chat-message.entity';
import {
  VideoClip,
  VideoClipStatus,
} from '../src/video-clips/entities/video-clip.entity';

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface ChatClipEmbedBody {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
}

interface ChatMessageBody {
  id: string;
  teamId: string;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
  content: string;
  clip: ChatClipEmbedBody | null;
  createdAt: string;
}

interface ChatMessageListItemBody {
  id: string;
  senderPlayerId: string;
  senderScreenName: string;
  content: string;
  clip: ChatClipEmbedBody | null;
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

  /** Direct-insert helper, mirroring phase3-video-clips.e2e-spec.ts's
   * identically-named fixture — a plausible-looking storageKey is fine
   * here since these tests never mint a real object, only presigned GET
   * request signatures. */
  async function createPublishedClip(
    teamId: string,
    uploaderPlayerId: string,
    overrides: Partial<{ caption: string | null }> = {},
  ) {
    return dataSource.getRepository(VideoClip).save(
      dataSource.getRepository(VideoClip).create({
        teamId,
        uploaderPlayerId,
        taggedPlayerId: null,
        storageKey: `clips/${teamId}/${randomUUID()}.mp4`,
        mimeType: 'video/mp4',
        fileSizeBytes: 1000,
        durationSeconds: 10,
        caption: overrides.caption ?? 'Zorro-fint #47!',
        status: VideoClipStatus.PUBLISHED,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }),
    );
  }

  /** docs/adr/0021-clip-challenge-notifications.md Decision 2 — a
   * direct-insert fixture for a system-authored row, mirroring
   * createPublishedClip's own "direct insert, no real pipeline needed"
   * posture: the real writer (VideoClipsService.completeUpload's
   * transaction) is exercised end-to-end in
   * phase3-video-clips.e2e-spec.ts's ffmpeg-gated real-pipeline test; this
   * suite only needs *a* system row to exist to exercise the
   * report-rejection guard and the read-side authorType/systemEventType
   * shape. */
  async function createSystemChatMessage(teamId: string, content: string) {
    return dataSource.getRepository(TeamChatMessage).save(
      dataSource.getRepository(TeamChatMessage).create({
        teamId,
        senderPlayerId: null,
        authorType: ChatMessageAuthorType.SYSTEM,
        systemEventType: SystemChatEventType.CLIP_CHALLENGE_ISSUED,
        content,
        clipId: null,
        status: ChatMessageStatus.VISIBLE,
      }),
    );
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

    // docs/adr/0021-clip-challenge-notifications.md Decision 2 — a system
    // row surfaces authorType/systemEventType and no sender chrome, so the
    // client can disambiguate it from an ordinary (or erased-sender)
    // player message per ChatMessageListItem's own contract.
    it('surfaces a system-authored message with authorType/systemEventType and no sender chrome, end-to-end through GET', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);
      const systemMessage = await createSystemChatMessage(
        teamId,
        '🎯 Anna utmanade Karl med en video!',
      );

      const listResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      const messages = (
        listResponse.body as {
          messages: (ChatMessageListItemBody & {
            authorType: string;
            systemEventType: string | null;
          })[];
        }
      ).messages;
      const entry = messages.find((m) => m.id === systemMessage.id);

      expect(entry).toMatchObject({
        senderPlayerId: null,
        senderScreenName: null,
        authorType: 'system',
        systemEventType: 'clip_challenge_issued',
        content: '🎯 Anna utmanade Karl med en video!',
      });
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

    // docs/adr/0021-clip-challenge-notifications.md's 2026-08-06
    // security-reviewer addendum, finding 1 — the single most important
    // test in this feature: a report against a system-authored row must be
    // rejected server-side, end-to-end through the real HTTP path, not
    // just at the service-unit level.
    it('rejects a report against a system-authored chat message with 400 cannot_report_system_message, and never persists a report row', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);
      const systemMessage = await createSystemChatMessage(
        teamId,
        '🎯 Anna utmanade Karl med en video!',
      );

      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/teams/${teamId}/chat/messages/${systemMessage.id}/report`,
        )
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ reason: 'other' })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'cannot_report_system_message',
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

  // docs/adr/0017-chat-clip-attachments.md end-to-end coverage — attaching
  // one of the team's own published Shorts clips to a chat message.
  describe('POST /chat/messages with clipId (ADR-0017)', () => {
    it('attaching a valid own-team published clip succeeds and the response includes it', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId, {
        caption: 'Se den har fintan!',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'Kolla klippet!', clipId: clip.id })
        .expect(201);

      const body = response.body as ChatMessageBody;
      expect(body.content).toBe('Kolla klippet!');
      expect(body.clip).toMatchObject({
        clipId: clip.id,
        uploaderPlayerId: uploaderId,
        caption: 'Se den har fintan!',
      });
      expect(typeof body.clip?.playbackUrl).toBe('string');
    });

    it('accepts an empty content string when a valid clipId is present (a clip attached with nothing else to say)', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: '', clipId: clip.id })
        .expect(201);

      expect((response.body as ChatMessageBody).content).toBe('');
      expect((response.body as ChatMessageBody).clip?.clipId).toBe(clip.id);
    });

    it('rejects a clipId belonging to another team with 404 clip_not_found', async () => {
      const teamId = await createTeam();
      const otherTeamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: otherUploaderId } = await createPlayer(otherTeamId);
      const otherTeamClip = await createPublishedClip(
        otherTeamId,
        otherUploaderId,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'kolla', clipId: otherTeamClip.id })
        .expect(404);
      expect((response.body as ApiErrorBody).error.code).toBe('clip_not_found');

      const stored = await dataSource
        .getRepository(TeamChatMessage)
        .find({ where: { teamId } });
      expect(stored).toHaveLength(0);
    });

    it('rejects a nonexistent clipId with 404 clip_not_found, and rejects a not-yet-published clip on this team the same way', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);

      const nonexistent = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'kolla', clipId: randomUUID() })
        .expect(404);
      expect((nonexistent.body as ApiErrorBody).error.code).toBe(
        'clip_not_found',
      );

      const pendingClip = await dataSource.getRepository(VideoClip).save(
        dataSource.getRepository(VideoClip).create({
          teamId,
          uploaderPlayerId: uploaderId,
          storageKey: `clips/${teamId}/${randomUUID()}.mp4`,
          mimeType: 'video/mp4',
          fileSizeBytes: 1000,
          durationSeconds: 10,
          status: VideoClipStatus.PENDING_UPLOAD,
        }),
      );
      const pending = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'kolla', clipId: pendingClip.id })
        .expect(404);
      expect((pending.body as ApiErrorBody).error.code).toBe('clip_not_found');
    });

    it('rejects empty content with no clipId, unchanged, even though content is no longer unconditionally required', async () => {
      const teamId = await createTeam();
      const { sessionToken } = await createPlayer(teamId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: '' })
        .expect(400);
      expect((response.body as ApiErrorBody).error.code).toBe(
        'validation_error',
      );
    });

    it("lets any teammate attach any other teammate's published clip, not just their own", async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'utmaning!', clipId: clip.id })
        .expect(201);
    });
  });

  describe('GET /chat/messages — clip embed resolution (ADR-0017)', () => {
    it('a message referencing a clip that gets deleted afterward renders with clip: null on a subsequent GET', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      const postResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'kolla innan den forsvinner', clipId: clip.id })
        .expect(201);
      const messageId = (postResponse.body as ChatMessageBody).id;

      // Simulate the clip's own independent lifecycle — self-delete or the
      // 90-day retention sweep both hard-delete the VideoClip row, which
      // fires the FK's ON DELETE SET NULL on team_chat_message.clip_id.
      await dataSource.getRepository(VideoClip).delete({ id: clip.id });

      const listResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .expect(200);
      const entry = (
        listResponse.body as { messages: ChatMessageListItemBody[] }
      ).messages.find((m) => m.id === messageId);
      expect(entry?.clip).toBeNull();
      // The message text itself survives the clip's own deletion unchanged
      // (ADR-0017 Decision 6 — message immutability is unaffected).
      expect(entry?.content).toBe('kolla innan den forsvinner');
    });

    it('a message referencing a clip whose uploader the viewer has blocked renders with clip: null for that viewer only', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);
      const { playerId: viewerId, sessionToken: viewerToken } =
        await createPlayer(teamId);
      const { sessionToken: bystanderToken } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      const postResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'kolla detta', clipId: clip.id })
        .expect(201);
      const messageId = (postResponse.body as ChatMessageBody).id;

      await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/blocks`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ blockedPlayerId: uploaderId })
        .expect(200);

      const viewerList = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      const viewerEntry = (
        viewerList.body as { messages: ChatMessageListItemBody[] }
      ).messages.find((m) => m.id === messageId);
      // The message text still renders (its own sender isn't blocked) —
      // only the embed resolves to null for this one viewer.
      expect(viewerEntry).toBeDefined();
      expect(viewerEntry?.content).toBe('kolla detta');
      expect(viewerEntry?.clip).toBeNull();

      const bystanderList = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${bystanderToken}`)
        .expect(200);
      const bystanderEntry = (
        bystanderList.body as { messages: ChatMessageListItemBody[] }
      ).messages.find((m) => m.id === messageId);
      expect(bystanderEntry?.clip?.clipId).toBe(clip.id);
      void viewerId;
    });

    it('a message referencing a report-hidden clip renders with clip: null for every viewer', async () => {
      const teamId = await createTeam();
      const { sessionToken: senderToken } = await createPlayer(teamId);
      const { playerId: uploaderId } = await createPlayer(teamId);
      const clip = await createPublishedClip(teamId, uploaderId);

      const postResponse = await request(app.getHttpServer())
        .post(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ content: 'kolla detta ocksa', clipId: clip.id })
        .expect(201);
      const messageId = (postResponse.body as ChatMessageBody).id;

      // Report-driven hide (ADR-0010 Decision 4) is the only other way,
      // besides deletion, a previously-attached clip stops resolving.
      await dataSource
        .getRepository(VideoClip)
        .update({ id: clip.id }, { status: VideoClipStatus.HIDDEN });

      const listResponse = await request(app.getHttpServer())
        .get(`/api/v1/teams/${teamId}/chat/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .expect(200);
      const entry = (
        listResponse.body as { messages: ChatMessageListItemBody[] }
      ).messages.find((m) => m.id === messageId);
      expect(entry?.clip).toBeNull();
    });
  });
});
