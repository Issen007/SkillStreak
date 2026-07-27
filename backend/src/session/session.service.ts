import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InvalidOrExpiredCodeException,
  SessionReissueRateLimitedException,
} from '../common/errors/exceptions';
import { PlayerTokenService } from '../auth/player-token.service';
import { PlayersService } from '../players/players.service';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { TeamsService } from '../teams/teams.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { buildSessionReissueEmail } from '../mail/templates/session-reissue-email.template';
import { Player } from '../players/entities/player.entity';
import {
  generateSessionReissueCode,
  SESSION_REISSUE_CODE_TTL_MS,
} from './session-reissue-code.util';

export interface SessionReissueTriggerResponse {
  requested: true;
  expiresAt: string;
}

export interface SessionReissueSelfServiceResponse {
  requested: true;
}

export interface SessionRedeemResponse {
  playerId: string;
  sessionToken: string;
}

// ADR-0004 Part 3 (player session reissue), redesigned per the ADR's
// 2026-07-27 addendum: the code is emailed to the target player's own
// parent_contact (via PlayerPrivateInfoService — never returned in an API
// response to whoever triggered the request), closing the confirmed
// critical account-takeover bug the original design had. Two trigger
// surfaces share the same internal mechanism: a team captain acting on a
// teammate's behalf (triggerReissue), and a new unauthenticated
// self-service lookup by team invite code + screen name
// (requestReissueSelfService), for the confirmed real "I already have an
// account" gap (docs/PROJECT.md's Fas 4 punch list). Deliberately its own
// module rather than folded into PlayersModule/PlayersController: this is
// a distinct auth-lifecycle concern (mirrors why ConsentModule is its own
// module rather than living in PlayersModule), even though it reuses
// Player's columns.
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly playerTokenService: PlayerTokenService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly teamsService: TeamsService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
  ) {}

  /**
   * POST /players/:playerId/session-reissue — captain-only (checked
   * against the *target* player's team, not the path; there is no
   * `:teamId` in this route). A cooldown-limit failure throws a real,
   * visible SessionReissueRateLimitedException here (unlike the
   * self-service path below) — the captain is already authorized, so
   * "try again later" leaks nothing.
   */
  async triggerReissue(
    requesterId: string,
    targetPlayerId: string,
  ): Promise<SessionReissueTriggerResponse> {
    const targetPlayer =
      await this.playersService.findByIdOrThrow(targetPlayerId);
    await this.playersService.assertIsCaptainOfTeam(
      requesterId,
      targetPlayer.teamId,
    );
    const expiresAt = await this.performReissue(targetPlayer);
    return { requested: true, expiresAt: expiresAt.toISOString() };
  }

  /**
   * POST /players/session/reissue-request — no auth (same
   * unauthenticated-by-necessity category as POST /players; the caller
   * has no session by definition). Resolves the target by team invite
   * code + case-insensitive screen name; if resolution, cooldown, or mail
   * send fails for *any* reason, that failure is swallowed here and the
   * exact same generic response returned regardless — this can never be
   * used to enumerate which screen names exist on a team. See the ADR
   * addendum for why this is safe to expose unauthenticated: redemption
   * is bound to parent_contact, not to whoever calls this endpoint.
   */
  async requestReissueSelfService(
    inviteCode: string,
    screenName: string,
  ): Promise<SessionReissueSelfServiceResponse> {
    try {
      const team = await this.teamsService.findByInviteCode(inviteCode);
      if (team) {
        const targetPlayer =
          await this.playersService.findUniqueByTeamAndScreenName(
            team.id,
            screenName,
          );
        if (targetPlayer) {
          await this.performReissue(targetPlayer);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Self-service session-reissue request did not complete (swallowed, generic response still returned): ${message}`,
      );
    }
    return { requested: true };
  }

  /**
   * POST /players/session/redeem — no auth (the whole point: the caller
   * has no valid session). Validates the code (exists, unexpired, unused),
   * nulls it (single-use), and issues a fresh JWT carrying the player's
   * *current* tokenVersion. Unchanged by the 2026-07-27 redesign — only
   * how the code *reaches* the player changed, not how it's redeemed.
   */
  async redeem(code: string): Promise<SessionRedeemResponse> {
    return this.dataSource.transaction(async (manager) => {
      const player = await this.playersService.findValidBySessionReissueCode(
        manager,
        code,
      );
      if (!player) {
        throw new InvalidOrExpiredCodeException();
      }
      await this.playersService.clearSessionReissueCode(manager, player.id);
      const sessionToken = this.playerTokenService.issueFor(
        player.id,
        player.tokenVersion,
      );
      return { playerId: player.id, sessionToken };
    });
  }

  /**
   * Shared by both trigger surfaces: claim the per-player cooldown (throws
   * SessionReissueRateLimitedException on failure — requestReissueSelfService
   * catches it into a silent/generic failure, triggerReissue lets it
   * propagate), bump token_version + generate a fresh code inside the same
   * row-locked transaction ADR-0004 Part 3 originally designed (unchanged),
   * then best-effort email it to parent_contact. Returns the code's expiry
   * so triggerReissue can surface it to the (authorized) captain — the
   * code itself never leaves this method.
   */
  private async performReissue(targetPlayer: Player): Promise<Date> {
    // Two independent layers, checked in sequence (not parallel) so a
    // burst-blocked attempt never burns the daily budget — a security-
    // reviewer finding on this addendum's first cut: the burst cooldown
    // alone still allowed sustained harassment (up to ~288/day) since this
    // can be triggered with no secret (see RedisService's comment on the
    // daily cap).
    const burstClaimed = await this.redisService.tryClaimSessionReissueCooldown(
      targetPlayer.id,
    );
    if (!burstClaimed) {
      throw new SessionReissueRateLimitedException();
    }
    const dailyClaimed = await this.redisService.tryClaimSessionReissueDailyCap(
      targetPlayer.id,
    );
    if (!dailyClaimed) {
      throw new SessionReissueRateLimitedException();
    }

    const { code, expiresAt } = await this.dataSource.transaction(
      async (manager) => {
        const locked = await this.playersService.findByIdForUpdate(
          manager,
          targetPlayer.id,
        );
        const generated = generateSessionReissueCode();
        await this.playersService.setSessionReissueCode(
          manager,
          targetPlayer.id,
          {
            newTokenVersion: locked.tokenVersion + 1,
            code: generated.code,
            expiresAt: generated.expiresAt,
          },
        );
        return generated;
      },
    );

    await this.sendReissueEmailBestEffort(targetPlayer, code);
    return expiresAt;
  }

  private async sendReissueEmailBestEffort(
    targetPlayer: Player,
    code: string,
  ): Promise<void> {
    // Best-effort, same posture as ConsentService.sendReminderEmailBestEffort:
    // a mail failure (or no parent contact on file, or SMTP unconfigured,
    // or parent_contact being a phone number — this app has no SMS
    // pipeline, a known pre-existing gap identical to consent's) must
    // never fail the underlying reissue — the token_version bump and fresh
    // code already succeeded, and are safe to leave in place for a future
    // resend attempt.
    try {
      const parentContact =
        await this.playerPrivateInfoService.getParentContact(targetPlayer.id);
      if (!parentContact) {
        this.logger.warn(
          `No parent contact on file for player ${targetPlayer.id} — reissue code stored but no email sent.`,
        );
        return;
      }
      const team = await this.teamsService.findById(targetPlayer.teamId);
      const email = buildSessionReissueEmail({
        screenName: targetPlayer.screenName,
        teamName: team?.name ?? '',
        code,
        expiresInMinutes: Math.round(SESSION_REISSUE_CODE_TTL_MS / 60_000),
      });
      await this.mailService.sendMail({
        to: parentContact,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send session-reissue email for player ${targetPlayer.id}: ${message}`,
      );
    }
  }
}
