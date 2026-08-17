import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { generateHumanCode } from '../common/crypto/human-code.util';
import { PlayerPrivateInfoService } from '../player-private-info/player-private-info.service';
import {
  PublicSharingConsent,
  PublicSharingConsentStatus,
  PublicSharingRevokedReason,
} from './entities/public-sharing-consent.entity';

/** Decision 1: the approval link expires; 14 days is the PT flow's own. */
export const REVIEW_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Decision 6: a month after the grant, then monthly from there. */
export const REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** Decision 5: two consecutive undeliverable reminders disable the consent. */
export const MAX_REMINDER_FAILURES = 2;

/**
 * ADR-0030's consent mechanism.
 *
 * **It gates nothing yet, on purpose.** ADR-0019's cross-team feed is
 * unbuilt, so no caller reads `isActiveFor` to publish anything. Building
 * this half first means the whole approve / remind / revoke lifecycle can
 * be exercised without a single clip leaving a team bubble.
 *
 * The lifecycle, and which decision each part comes from:
 *
 * - `request` — Decision 1. A separate grant, default off, never a
 *   reinterpretation of the media consent a family already gave. Also
 *   Decision 10: it refuses outright when there is no parent contact,
 *   which is what stops a 13+ self-verified account from enabling
 *   sharing with nobody supervising it.
 * - `approveByReviewCode` / `declineByReviewCode` — Decision 1's mailed
 *   approval, reusing the PT flow's shape.
 * - `revokeByRevokeCode` — Decision 2. Immediate, no confirmation, no
 *   login, and the code never expires.
 * - `sweepDueReminders` — Decisions 4, 5 and 6.
 */
@Injectable()
export class PublicSharingConsentService {
  private readonly logger = new Logger(PublicSharingConsentService.name);

  constructor(
    @InjectRepository(PublicSharingConsent)
    private readonly consents: Repository<PublicSharingConsent>,
    private readonly playerPrivateInfoService: PlayerPrivateInfoService,
  ) {}

  /**
   * The read ADR-0019 will eventually gate on. Nothing calls it yet.
   *
   * Deliberately a boolean rather than the row: a caller deciding whether
   * a clip may be published has no business branching on *why* a consent
   * is inactive, and returning the row would invite exactly that.
   */
  async isActiveFor(playerId: string): Promise<boolean> {
    const row = await this.consents.findOne({ where: { playerId } });
    return row?.status === PublicSharingConsentStatus.ACTIVE;
  }

  /**
   * Ask the parent. Returns the review code so a caller can build the
   * link; the mail itself is a separate concern.
   *
   * Re-requesting overwrites the existing row rather than adding one —
   * Decision 2 makes re-enabling a fresh grant, and one row per player is
   * what keeps "is sharing on for this child" from having two answers.
   */
  async request(playerId: string): Promise<{ reviewCode: string }> {
    // Decision 10, enforced before anything is written. A self-verified
    // 13+ account has no parent contact, and under the amended Decision 3
    // the monthly reminder is the design's only recurring control — so
    // admitting an account with no recipient for it would mean not a
    // weaker control but none at all.
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
    const existing = await this.consents.findOne({ where: { playerId } });
    const row = existing ?? this.consents.create({ playerId });

    row.status = PublicSharingConsentStatus.PENDING_REVIEW;
    row.reviewCode = code;
    row.reviewCodeExpiresAt = expiresAt;
    // A pending request is not an active consent, so anything the
    // previous grant left behind is cleared rather than carried over.
    row.revokeCode = null;
    row.approvedAt = null;
    row.declinedAt = null;
    row.revokedAt = null;
    row.revokedReason = null;
    row.lastReminderAt = null;
    row.reminderFailureCount = 0;
    await this.consents.save(row);

    return { reviewCode: code };
  }

  /** Grants it. Returns the revoke code for the confirmation mail. */
  async approveByReviewCode(
    code: string,
  ): Promise<{ playerId: string; revokeCode: string } | null> {
    const row = await this.findPendingByReviewCode(code);
    if (!row) return null;

    const { code: revokeCode } = generateHumanCode(0);
    row.status = PublicSharingConsentStatus.ACTIVE;
    row.approvedAt = new Date();
    row.reviewCode = null;
    row.reviewCodeExpiresAt = null;
    row.revokeCode = revokeCode;
    // Decision 6: the reminder clock starts at the grant, not at the
    // start of a calendar month, so a family that opts in on the 20th
    // hears on the 20th.
    row.lastReminderAt = new Date();
    row.reminderFailureCount = 0;
    await this.consents.save(row);

    return { playerId: row.playerId, revokeCode };
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

  /**
   * Every consent whose monthly reminder is due.
   *
   * Returned rather than mailed here so the sweep that sends them can be
   * tested without a mail server, and so this service does not grow a
   * dependency on one.
   */
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
   * undeliverable address would stay perpetually due and be retried on
   * every sweep, reaching the disable threshold within minutes rather
   * than over two months — turning "two missed months" into "two
   * attempts".
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

  private async deactivate(
    row: PublicSharingConsent,
    reason: PublicSharingRevokedReason,
  ): Promise<{ revoked: true }> {
    row.status = PublicSharingConsentStatus.REVOKED;
    row.revokedAt = new Date();
    row.revokedReason = reason;
    // Both codes cleared: a revoked consent must not be re-approvable
    // from an old link, and its disable link has nothing left to do.
    row.reviewCode = null;
    row.reviewCodeExpiresAt = null;
    row.revokeCode = null;
    await this.consents.save(row);
    return { revoked: true };
  }

  private async findPendingByReviewCode(
    code: string,
  ): Promise<PublicSharingConsent | null> {
    if (!code) return null;
    const row = await this.consents.findOne({ where: { reviewCode: code } });
    if (!row || row.status !== PublicSharingConsentStatus.PENDING_REVIEW) {
      return null;
    }
    if (
      row.reviewCodeExpiresAt &&
      row.reviewCodeExpiresAt.getTime() < Date.now()
    ) {
      row.status = PublicSharingConsentStatus.EXPIRED;
      row.reviewCode = null;
      await this.consents.save(row);
      return null;
    }
    return row;
  }
}
