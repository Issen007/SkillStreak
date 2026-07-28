import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ContactChangeRateLimitedException,
  InvalidOrExpiredContactChangeCodeException,
} from '../common/errors/exceptions';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { MailService } from '../mail/mail.service';
import { buildContactChangeCancelEmail } from '../mail/templates/contact-change-cancel-email.template';
import { buildContactChangeConfirmEmail } from '../mail/templates/contact-change-confirm-email.template';
import { buildContactChangeNotifyOldEmail } from '../mail/templates/contact-change-notify-old-email.template';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';

// 15 minutes — same window as session-reissue codes (ADR-0004 Part 3),
// same reasoning: a short, single-sitting confirmation action, not a
// week-long approval like initial parental consent.
const CONTACT_CHANGE_CODE_TTL_MS = 15 * 60 * 1000;

// Same fallback as ConsentService's DEFAULT_APP_PUBLIC_URL, for the same
// reason (this is a browser link, not an app deep link — needs a real
// host to be clickable from an email).
const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';

// security-reviewer finding, 2026-07-28 (docs/adr/0012's addendum): a
// live session token is sufficient to trigger both request and confirm,
// and this app has no password to re-check for a sensitive action. The
// grace period is what actually protects against a momentarily-
// compromised session — 24h is short enough to not be annoying for a
// real change, long enough that a real account owner checking their old
// inbox even once a day will see the cancel email in time.
const CONTACT_CHANGE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export interface PlayerProfile {
  realName: string | null;
  birthYear: number;
  parentContact: string;
}

export interface RequestContactChangeResponse {
  requested: true;
  expiresAt: string;
}

export interface ConfirmContactChangeResponse {
  confirmed: true;
  appliesAt: string;
}

// docs/adr/0012-profile-page-and-contact-email-change.md. Every method
// except cancelContactChange operates on the *authenticated caller's
// own* playerId (`/players/me/...` routes, no `:playerId` param) — no
// IDOR surface to begin with. cancelContactChange is the one
// unauthenticated exception, by necessity — the whole point is that the
// OLD address might not want to rely on whatever session is currently
// live on the account (see the ADR addendum).
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly playersService: PlayersService,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async getProfile(playerId: string): Promise<PlayerProfile> {
    const player = await this.playersService.findByIdOrThrow(playerId);
    const [realName, parentContact] = await Promise.all([
      this.playerPrivateInfoService.getRealName(playerId),
      this.playerPrivateInfoService.getParentContact(playerId),
    ]);
    return {
      realName,
      birthYear: player.birthYear,
      // getParentContact returns null only if the PlayerPrivateInfo row
      // itself is missing, which can't happen for a real, already-
      // onboarded player (createForNewPlayer always creates one) — safe
      // to assert non-null here rather than threading a third optional
      // state through the response type for an unreachable case.
      parentContact: parentContact as string,
    };
  }

  async updateRealName(
    playerId: string,
    realName: string | null,
  ): Promise<void> {
    await this.playerPrivateInfoService.updateRealName(playerId, realName);
  }

  /**
   * docs/adr/0012's decision 1, steps 1-3. Always throws
   * ContactChangeRateLimitedException on cooldown/cap failure (unlike
   * SessionService's self-service path, this endpoint requires the
   * caller to already hold a valid session for the target account, so
   * there's no unauthenticated-enumeration concern to swallow it for —
   * "try again later" leaks nothing the caller doesn't already know).
   */
  async requestContactChange(
    playerId: string,
    newContact: string,
  ): Promise<RequestContactChangeResponse> {
    const burstClaimed =
      await this.redisService.tryClaimContactChangeCooldown(playerId);
    if (!burstClaimed) {
      throw new ContactChangeRateLimitedException();
    }
    const dailyClaimed =
      await this.redisService.tryClaimContactChangeDailyCap(playerId);
    if (!dailyClaimed) {
      throw new ContactChangeRateLimitedException();
    }

    const player = await this.playersService.findByIdOrThrow(playerId);
    const oldContact =
      await this.playerPrivateInfoService.getParentContact(playerId);
    const { code, expiresAt } = generateHumanCode(CONTACT_CHANGE_CODE_TTL_MS);

    await this.dataSource.transaction(async (manager) => {
      await this.playerPrivateInfoService.setPendingContactChange(
        manager,
        playerId,
        { pendingContact: newContact, code, expiresAt },
      );
    });

    await this.sendRequestEmailsBestEffort(
      player.screenName,
      newContact,
      oldContact,
      code,
    );

    return { requested: true, expiresAt: expiresAt.toISOString() };
  }

  /**
   * security-reviewer finding, 2026-07-28 — no longer applies the change
   * immediately. Starts a 24h grace period instead, and emails the OLD
   * address a distinct cancel code (see the ADR addendum for the full
   * reasoning). The actual apply happens lazily, on the next read that
   * notices the grace period has elapsed (PlayerPrivateInfoService
   * .getEffective) — not from this method.
   */
  async confirmContactChange(
    playerId: string,
    code: string,
  ): Promise<ConfirmContactChangeResponse> {
    const player = await this.playersService.findByIdOrThrow(playerId);
    const oldContact =
      await this.playerPrivateInfoService.getParentContact(playerId);
    const { code: cancelCode, expiresAt: applyAt } = generateHumanCode(
      CONTACT_CHANGE_GRACE_PERIOD_MS,
    );

    await this.dataSource.transaction(async (manager) => {
      const info =
        await this.playerPrivateInfoService.findValidByContactChangeCode(
          manager,
          code,
        );
      // Also checked that the code belongs to *this* authenticated
      // caller, not just that some valid code was supplied — defense in
      // depth on top of the code's own entropy (the code is only ever
      // emailed to the candidate new address, so guessing/obtaining
      // another player's code by chance is already infeasible, but this
      // costs nothing and closes the class of bug entirely rather than
      // relying on entropy alone).
      if (!info || info.playerId !== playerId || !info.pendingParentContact) {
        throw new InvalidOrExpiredContactChangeCodeException();
      }
      await this.playerPrivateInfoService.startContactChangeGracePeriod(
        manager,
        playerId,
        { applyAt, cancelCode },
      );
    });

    await this.sendCancelEmailBestEffort(
      player.screenName,
      oldContact,
      cancelCode,
    );

    return { confirmed: true, appliesAt: applyAt.toISOString() };
  }

  /**
   * No auth — the OLD address is the one acting here, and the whole
   * point is that it might not want to rely on whatever session is
   * currently live on the account (see the ADR addendum). Bumps
   * token_version on success: the old address holder saying "this
   * wasn't me" is exactly the moment forcing a fresh login is warranted.
   */
  /** GET-side preview for the cancel link — no side effects, see
   * PlayerPrivateInfoService.previewByCancelCode's comment. */
  async previewCancelContactChange(
    code: string,
  ): Promise<{ screenName: string } | null> {
    const info = await this.playerPrivateInfoService.previewByCancelCode(code);
    if (!info) return null;
    const player = await this.playersService.findByIdOrThrow(info.playerId);
    return { screenName: player.screenName };
  }

  /**
   * The POST side of the cancel link. Returns `null` (not a thrown
   * exception) for "no such code / already used / grace period already
   * elapsed" — same idiom as ConsentService.approve, since a second POST
   * to an already-consumed link (a double-tap, or the flow exercised
   * twice) is an expected case the controller renders as a friendly page,
   * not an error.
   */
  async cancelContactChange(
    code: string,
  ): Promise<{ screenName: string } | null> {
    return this.dataSource.transaction(async (manager) => {
      const info = await this.playerPrivateInfoService.findValidByCancelCode(
        manager,
        code,
      );
      if (!info) {
        return null;
      }
      await this.playerPrivateInfoService.cancelPendingContactChange(
        manager,
        info.playerId,
      );
      const player = await this.playersService.findByIdForUpdate(
        manager,
        info.playerId,
      );
      await this.playersService.bumpTokenVersion(
        manager,
        info.playerId,
        player.tokenVersion + 1,
      );
      return { screenName: player.screenName };
    });
  }

  private async sendRequestEmailsBestEffort(
    screenName: string,
    newContact: string,
    oldContact: string | null,
    code: string,
  ): Promise<void> {
    // Best-effort, same posture as every other mail send in this app
    // (ConsentService, SessionService) — a failure here must never undo
    // the already-committed pending-change row; the player can always
    // request again once the cooldown clears.
    const confirmEmail = buildContactChangeConfirmEmail({
      screenName,
      code,
      expiresInMinutes: Math.round(CONTACT_CHANGE_CODE_TTL_MS / 60_000),
    });
    try {
      await this.mailService.sendMail({
        to: newContact,
        subject: confirmEmail.subject,
        html: confirmEmail.html,
        text: confirmEmail.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send contact-change confirm email to the new address: ${message}`,
      );
    }

    if (!oldContact) return;
    const notifyEmail = buildContactChangeNotifyOldEmail({ screenName });
    try {
      await this.mailService.sendMail({
        to: oldContact,
        subject: notifyEmail.subject,
        html: notifyEmail.html,
        text: notifyEmail.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send contact-change notify email to the old address: ${message}`,
      );
    }
  }

  private async sendCancelEmailBestEffort(
    screenName: string,
    oldContact: string | null,
    cancelCode: string,
  ): Promise<void> {
    if (!oldContact) {
      this.logger.warn(
        `No old contact on file to send the contact-change cancel code to — the grace period still applies, but nobody was notified.`,
      );
      return;
    }
    const appPublicUrl =
      this.configService.get<string>('APP_PUBLIC_URL') ??
      DEFAULT_APP_PUBLIC_URL;
    const cancelUrl = `${appPublicUrl}/api/v1/players/contact-change-cancel/${cancelCode}`;
    const cancelEmail = buildContactChangeCancelEmail({
      screenName,
      cancelUrl,
      graceHours: Math.round(CONTACT_CHANGE_GRACE_PERIOD_MS / 3_600_000),
    });
    try {
      await this.mailService.sendMail({
        to: oldContact,
        subject: cancelEmail.subject,
        html: cancelEmail.html,
        text: cancelEmail.text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to send contact-change cancel email to the old address: ${message}`,
      );
    }
  }
}
