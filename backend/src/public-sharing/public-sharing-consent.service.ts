import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { decryptPii, encryptPii } from '../common/crypto/pii-encryption.util';
import { MailService } from '../mail/mail.service';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import {
  PublicSharingConsent,
  PublicSharingConsentStatus,
  PublicSharingRevokedReason,
} from './entities/public-sharing-consent.entity';

/** Decision 1: the approval link expires; 14 days matches the PT flow. */
export const REVIEW_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Decision 6: a month after the grant, then monthly from there. */
export const REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** Decision 5: two consecutive undeliverable reminders disable the consent. */
export const MAX_REMINDER_FAILURES = 2;

/** What a preview may reveal: enough to render a page, never a decision. */
export interface ConsentPreview {
  playerId: string;
  status: PublicSharingConsentStatus;
}

/**
 * ADR-0030's consent mechanism.
 *
 * **It gates nothing yet, on purpose.** ADR-0019's cross-team feed is
 * unbuilt, so no caller reads `isActiveFor` to publish anything. Building
 * this half first means the whole approve / remind / revoke lifecycle can
 * be exercised without a single clip leaving a team bubble.
 *
 * **Amended after the blocking security review, 2026-08-17.** The review
 * found that this had claimed to mirror `pt-consent.service.ts` while
 * dropping most of the protections that make that file safe. Four of its
 * findings are answered here, and each is marked at the code:
 *
 * - The codes never leave this service except by email (finding 1).
 * - Preview is separate from acting, and does not mutate (finding 2).
 * - The parent contact is checked against a pending contact change and
 *   then frozen, so it cannot be re-pointed later (finding 3).
 * - An active consent cannot be silently replaced by a new request
 *   (finding 7).
 *
 * Still open and tracked in the ADR: bounce detection (finding 4, which
 * lives in MailService, not here), row locking (6), rate limiting (8),
 * and the migration that must carry the ON DELETE CASCADE this table's
 * erasure behaviour depends on (5).
 */
@Injectable()
export class PublicSharingConsentService {
  private readonly logger = new Logger(PublicSharingConsentService.name);

  constructor(
    @InjectRepository(PublicSharingConsent)
    private readonly consents: Repository<PublicSharingConsent>,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.configService.getOrThrow<string>('PII_ENCRYPTION_KEY');
  }

  /**
   * The read ADR-0019 will eventually gate on. Nothing calls it yet.
   *
   * A boolean rather than the row: a caller deciding whether a clip may
   * be published has no business branching on *why* a consent is
   * inactive, and returning the row would invite exactly that.
   *
   * **It cannot enforce Decision 3's "only the child's own clips"** —
   * this is account-scoped and says nothing about whose clip is in hand.
   * That obligation belongs to the ADR-0019 caller and is recorded in the
   * ADR rather than left to be discovered during integration (finding 13).
   */
  async isActiveFor(playerId: string): Promise<boolean> {
    const row = await this.consents.findOne({ where: { playerId } });
    return row?.status === PublicSharingConsentStatus.ACTIVE;
  }

  /**
   * Ask the parent.
   *
   * **Finding 1.** Returns no code. The approval link's only exit from
   * this process is the parent's inbox — that is the single property that
   * makes a mailed consent mean anything, and returning the code to the
   * caller removed it, leaving "child taps Enable" and "child's video may
   * leave the team" two in-process calls apart.
   */
  async request(
    playerId: string,
  ): Promise<{ requested: true; expiresAt: Date }> {
    const existing = await this.consents.findOne({ where: { playerId } });

    // Finding 7. An active consent is ended deliberately, never replaced
    // by a new request. Overwriting it in place skipped `deactivate()` —
    // and with it ADR-0019 Decision 5's un-publish hook — which would
    // leave clips published with no active consent behind them, the exact
    // state this ADR exists to make impossible. It also erased the record
    // that a parent ever approved, which Article 7(1) requires be
    // demonstrable and Decision 9's monthly review needs in order to ask
    // "has any parent actually disabled this?".
    if (existing?.status === PublicSharingConsentStatus.ACTIVE) {
      throw new Error(
        'public-sharing consent is already active for this player — it ' +
          'must be revoked before a new request (ADR-0030 Decision 2)',
      );
    }

    // Finding 3. A pending contact change means the address on file is
    // in the middle of being repointed, and the confirmation for that
    // goes to the NEW address. Requesting through that window is how a
    // player redirects their own parental approval to themselves. PT
    // refuses for the same reason.
    if (await this.playerPrivateInfoService.hasPendingContactChange(playerId)) {
      throw new Error(
        'a parent contact change is pending — public-sharing consent ' +
          'cannot be requested until it settles or is cancelled',
      );
    }

    // Decisions 1 and 10. A self-verified 13+ account has no parent
    // contact, and since the amended Decision 3 makes the monthly
    // reminder the only recurring control, admitting such an account
    // would mean not a weaker control but none at all.
    const parentContact =
      await this.playerPrivateInfoService.getParentContact(playerId);
    if (!parentContact) {
      throw new Error(
        'public-sharing consent needs a parent contact — a self-verified ' +
          'account must add one before sharing can be enabled (ADR-0030 ' +
          'Decision 10)',
      );
    }

    const { code, expiresAt } = generateHumanCode(REVIEW_CODE_TTL_MS);
    const row = existing ?? this.consents.create({ playerId });

    row.status = PublicSharingConsentStatus.PENDING_REVIEW;
    row.reviewCode = code;
    row.reviewCodeExpiresAt = expiresAt;
    // Finding 3, second half: frozen here for the row's lifetime. Every
    // later mail — including years of monthly reminders — goes to the
    // address that granted the consent, not to whatever the profile says
    // by then. A consent that follows a changed address is a consent that
    // can be handed to someone else without the grantor knowing.
    row.recipientContactSnapshot = encryptPii(
      parentContact,
      this.encryptionKey,
    );
    row.revokeCode = null;
    row.approvedAt = null;
    row.declinedAt = null;
    row.revokedAt = null;
    row.revokedReason = null;
    row.lastReminderAt = null;
    row.reminderFailureCount = 0;
    await this.consents.save(row);

    await this.sendBestEffort(
      parentContact,
      'SkillStreak: godkänn delning utanför laget',
      `Ditt barn vill kunna dela sina egna klipp utanför laget.\n\n` +
        `Godkänn: ${this.approvalUrl(code)}\n\n` +
        `Om du inte gör något händer ingenting. Länken slutar gälla om ` +
        `14 dagar.`,
    );

    return { requested: true, expiresAt };
  }

  /**
   * Finding 2. Read-only, for a GET.
   *
   * Mail clients and corporate link scanners prefetch URLs. Without a
   * verb that only looks, the obvious wiring — GET the code straight into
   * `approve` — means Outlook Safe Links can grant a child's publication
   * consent with no human forming an intent. Mirrors the GET/POST split
   * ADR-0013 already made a repo convention.
   */
  async previewByReviewCode(code: string): Promise<ConsentPreview | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { reviewCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.PENDING_REVIEW) {
      return null;
    }
    if (!this.isReviewCodeLive(row)) return null;
    return { playerId: row.playerId, status: row.status };
  }

  async previewByRevokeCode(code: string): Promise<ConsentPreview | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { revokeCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.ACTIVE) return null;
    return { playerId: row.playerId, status: row.status };
  }

  /**
   * Grants it. Finding 1: the revoke code is mailed, never returned.
   */
  async approveByReviewCode(code: string): Promise<{ approved: true } | null> {
    const row = await this.findPendingByReviewCode(code);
    if (!row) return null;

    const { code: revokeCode } = generateHumanCode(0);
    row.status = PublicSharingConsentStatus.ACTIVE;
    row.approvedAt = new Date();
    row.reviewCode = null;
    row.reviewCodeExpiresAt = null;
    row.revokeCode = revokeCode;
    // Decision 6: the clock starts at the grant, so a family that opts in
    // on the 20th hears on the 20th rather than on the 1st with everyone.
    row.lastReminderAt = new Date();
    row.reminderFailureCount = 0;
    await this.consents.save(row);

    await this.sendBestEffort(
      this.recipientOf(row),
      'SkillStreak: delning är påslagen',
      `Delning utanför laget är nu påslagen för ditt barn.\n\n` +
        `Du kan stänga av den när som helst: ${this.revokeUrl(revokeCode)}\n\n` +
        `Spara det här mejlet — vi påminner dig en gång i månaden så länge ` +
        `delningen är påslagen.`,
    );

    return { approved: true };
  }

  async declineByReviewCode(code: string): Promise<{ declined: true } | null> {
    const row = await this.findPendingByReviewCode(code);
    if (!row) return null;

    row.status = PublicSharingConsentStatus.DECLINED;
    row.declinedAt = new Date();
    row.reviewCode = null;
    row.reviewCodeExpiresAt = null;
    await this.consents.save(row);

    return { declined: true };
  }

  /**
   * Decision 2: off is immediate, unconditional and needs no login.
   *
   * Deletes nothing. Withdrawing consent to *publication* is not a
   * request to destroy the child's own material, and conflating the two
   * would punish the safer choice.
   */
  async revokeByRevokeCode(code: string): Promise<{ revoked: true } | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { revokeCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.ACTIVE) return null;

    return this.deactivate(row, PublicSharingRevokedReason.PARENT_REVOKED);
  }

  /** Every consent whose monthly reminder is due. */
  async findDueReminders(
    now: Date = new Date(),
  ): Promise<PublicSharingConsent[]> {
    return this.consents.find({
      where: {
        status: PublicSharingConsentStatus.ACTIVE,
        lastReminderAt: LessThanOrEqual(
          new Date(now.getTime() - REMINDER_INTERVAL_MS),
        ),
      },
      order: { lastReminderAt: 'ASC' },
      take: 500,
    });
  }

  /** A reminder went out. Clears the failure streak. */
  async recordReminderSent(id: string, now: Date = new Date()): Promise<void> {
    await this.consents.update(id, {
      lastReminderAt: now,
      reminderFailureCount: 0,
    });
  }

  /**
   * A reminder could not be delivered. Decision 5 disables at two in a
   * row: an unreachable parent on an account whose media can leave its
   * team means the supervision this design rests on has stopped.
   *
   * `lastReminderAt` advances on failure too. Without that, a permanently
   * undeliverable address stays perpetually due, is retried on every
   * sweep, and reaches the threshold within minutes rather than over two
   * months — turning "two missed months" into "two attempts".
   */
  async recordReminderFailure(
    id: string,
    now: Date = new Date(),
  ): Promise<{ disabled: boolean }> {
    const row = await this.consents.findOne({ where: { id } });
    if (!row || row.status !== PublicSharingConsentStatus.ACTIVE) {
      return { disabled: false };
    }

    row.reminderFailureCount += 1;
    row.lastReminderAt = now;

    if (row.reminderFailureCount >= MAX_REMINDER_FAILURES) {
      await this.deactivate(
        row,
        PublicSharingRevokedReason.REMINDER_UNDELIVERABLE,
      );
      this.logger.warn(
        `Public-sharing consent ${row.id} disabled: ${row.reminderFailureCount} ` +
          'consecutive undeliverable reminders.',
      );
      return { disabled: true };
    }

    await this.consents.save(row);
    return { disabled: false };
  }

  /** The address that granted the consent, not whatever the profile says now. */
  recipientOf(row: PublicSharingConsent): string | null {
    return row.recipientContactSnapshot
      ? decryptPii(row.recipientContactSnapshot, this.encryptionKey)
      : null;
  }

  private async deactivate(
    row: PublicSharingConsent,
    reason: PublicSharingRevokedReason,
  ): Promise<{ revoked: true }> {
    row.status = PublicSharingConsentStatus.REVOKED;
    row.revokedAt = new Date();
    row.revokedReason = reason;
    // Both cleared: a revoked consent must not be re-approvable from an
    // old link, and its disable link has nothing left to do.
    row.reviewCode = null;
    row.reviewCodeExpiresAt = null;
    row.revokeCode = null;
    await this.consents.save(row);
    return { revoked: true };
  }

  /**
   * Finding 9. Null means NOT live, matching PT's `isReviewCodeLive`.
   * Reading a missing expiry as "never expires" is the wrong direction to
   * fail in for a code that grants publication of a child's video.
   */
  private isReviewCodeLive(row: PublicSharingConsent): boolean {
    return (
      row.reviewCodeExpiresAt !== null &&
      row.reviewCodeExpiresAt.getTime() > Date.now()
    );
  }

  private async findPendingByReviewCode(
    code: string,
  ): Promise<PublicSharingConsent | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { reviewCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.PENDING_REVIEW) {
      return null;
    }
    if (!this.isReviewCodeLive(row)) {
      row.status = PublicSharingConsentStatus.EXPIRED;
      row.reviewCode = null;
      row.reviewCodeExpiresAt = null;
      await this.consents.save(row);
      return null;
    }
    return row;
  }

  private appPublicUrl(): string {
    return this.configService.get<string>('APP_PUBLIC_URL') ?? '';
  }

  private approvalUrl(code: string): string {
    return `${this.appPublicUrl()}/api/v1/public-sharing-consent/${code}`;
  }

  private revokeUrl(code: string): string {
    return `${this.appPublicUrl()}/api/v1/public-sharing-consent/revoke/${code}`;
  }

  /**
   * Mail failures must not roll back a consent decision that has already
   * been persisted — the same best-effort posture as PT's. Note this is
   * NOT the delivery signal Decision 5 needs: see finding 4, which lives
   * in MailService and is still open.
   */
  private async sendBestEffort(
    to: string | null,
    subject: string,
    text: string,
  ): Promise<void> {
    if (!to) return;
    try {
      // Plain text only for now: these are short, and an HTML body would
      // need the same escaping and template review the consent-page
      // templates already carry. Worth doing before this is exposed.
      await this.mailService.sendMail({ to, subject, text, html: text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Public-sharing consent mail failed: ${message}`);
    }
  }
}
