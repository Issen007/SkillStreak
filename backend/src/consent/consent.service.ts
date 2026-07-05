import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ConsentNotPendingException,
  ConsentReminderRateLimitedException,
} from '../common/errors/exceptions';
import { MailService } from '../mail/mail.service';
import { buildConsentRequestEmail } from '../mail/templates/consent-request-email.template';
import { ConsentMethod } from '../player-private-info/entities/parental-consent-record.entity';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { generateConsentToken } from '../players/consent-token.util';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import { TeamsService } from '../teams/teams.service';

const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

export interface ConsentPreview {
  screenName: string;
}

export interface ConsentApprovalResult {
  screenName: string;
}

export interface ConsentReminderResult {
  sentAt: Date;
}

// Orchestrates the parent-facing consent-approval flow across both
// PlayersModule (the token + gameplay-gating status live on Player) and
// PlayerPrivateInfoModule (the append-only ParentalConsentRecord audit
// trail) — this is the one other module (besides OnboardingService)
// allowed to depend on both, per docs/adr/0002-data-model.md's addendum §1.
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly teamsService: TeamsService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Read-only preview for GET /api/v1/consent/:token — no side effects, see
   * ConsentController's comment on why (email client/security-scanner
   * prefetching). Returns null for both "no such token" and "expired",
   * deliberately not distinguished.
   */
  async previewByToken(token: string): Promise<ConsentPreview | null> {
    const player = await this.playersService.findValidByConsentToken(token);
    return player ? { screenName: player.screenName } : null;
  }

  /**
   * The actual approval, for POST /api/v1/consent/:token: flips
   * Player.parental_consent_status to approved and clears the token
   * (PlayersService.approveByConsentToken), then appends the audit-trail
   * ParentalConsentRecord (PlayerPrivateInfoService) — both in one
   * transaction, matching OnboardingService's cross-module write pattern.
   * Returns null if the token was already consumed/invalid/expired, which
   * the controller renders as a friendly "already confirmed" page.
   */
  async approve(token: string): Promise<ConsentApprovalResult | null> {
    return this.dataSource.transaction(async (manager) => {
      const player = await this.playersService.approveByConsentToken(
        manager,
        token,
      );
      if (!player) {
        return null;
      }

      await this.playerPrivateInfoService.recordConsentEvent(
        manager,
        player.id,
        ParentalConsentStatus.APPROVED,
        ConsentMethod.EMAIL_LINK,
      );

      return { screenName: player.screenName };
    });
  }

  /**
   * POST /api/v1/players/:playerId/consent-reminder — docs/api/phase2-
   * contract.md endpoint 3. Captain-only (checked against the *target*
   * player's team — a captain triggers this for a teammate, not
   * themselves). Reuses the same consent_token/consent_token_expires_at
   * columns and email template as the original onboarding send, mirroring
   * OnboardingService's mail-sending shape (best-effort: a mail failure
   * doesn't fail the request).
   *
   * **Flagged for security-reviewer** (ADR-0005's Consequences): this now
   * sends a real email nudge to a teammate's parent, triggered by another
   * child rather than an adult coach — the mechanism/rate-limiting is
   * identical to the old coach-triggered design, the trust model
   * triggering it is not.
   */
  async sendReminder(
    requesterId: string,
    targetPlayerId: string,
  ): Promise<ConsentReminderResult> {
    const targetPlayer =
      await this.playersService.findByIdOrThrow(targetPlayerId);
    await this.playersService.assertIsCaptainOfTeam(
      requesterId,
      targetPlayer.teamId,
    );

    if (targetPlayer.parentalConsentStatus !== ParentalConsentStatus.PENDING) {
      throw new ConsentNotPendingException();
    }

    // Claimed only after the checks above, so a captain who isn't
    // authorized or whose target isn't actually pending doesn't burn the
    // cooldown window on a request that was always going to fail.
    const claimed =
      await this.redisService.tryClaimConsentReminderCooldown(targetPlayerId);
    if (!claimed) {
      throw new ConsentReminderRateLimitedException();
    }

    const { token, expiresAt } = generateConsentToken();
    await this.dataSource.transaction(async (manager) => {
      await this.playersService.setConsentToken(
        manager,
        targetPlayerId,
        token,
        expiresAt,
      );
    });

    await this.sendReminderEmailBestEffort(
      targetPlayer.id,
      targetPlayer.screenName,
      targetPlayer.teamId,
      token,
    );

    return { sentAt: new Date() };
  }

  private async sendReminderEmailBestEffort(
    playerId: string,
    screenName: string,
    teamId: string,
    consentToken: string,
  ): Promise<void> {
    // Best-effort, same posture as OnboardingService's initial send: a
    // mail failure (or no parent contact on file, or SMTP unconfigured)
    // must never fail the reminder request itself — the token/row already
    // exist for a future resend.
    try {
      const parentContact =
        await this.playerPrivateInfoService.getParentContact(playerId);
      if (!parentContact) {
        this.logger.warn(
          `No parent contact on file for player ${playerId} — reminder token stored but no email sent.`,
        );
        return;
      }
      const team = await this.teamsService.findById(teamId);
      const appPublicUrl =
        this.configService.get<string>('APP_PUBLIC_URL') ??
        DEFAULT_APP_PUBLIC_URL;
      const consentUrl = `${appPublicUrl}/api/v1/consent/${consentToken}`;
      const email = buildConsentRequestEmail({
        screenName,
        teamName: team?.name ?? '',
        consentUrl,
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
        `Failed to send consent reminder email for player ${playerId}: ${message}`,
      );
    }
  }
}
