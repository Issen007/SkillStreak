import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * docs/adr/0030-revocable-public-sharing-consent.md — the standing,
 * revocable parental consent that lets a player's own clips be published
 * beyond their team.
 *
 * **This gates a feature that does not exist yet.** ADR-0019's cross-team
 * feed is unbuilt, so nothing in this codebase reads an active consent to
 * publish anything. That is the deliberate build order: the consent
 * mechanism can be written and tested without a single clip leaving a
 * team bubble, which is also why ADR-0019's two owner-only prerequisites
 * (CLAUDE.md's closed-bubble sentence, and the "only your own team" copy
 * across six surfaces) do not block this half — those promises only
 * become false when clips actually cross teams.
 *
 * Structurally a sibling of PtPlayerConsent (ADR-0023 Decision A3), which
 * ADR-0019's own security pass named the shipped reference for this
 * pattern: a `review_code` for granting, and a separate, deliberately
 * **non-expiring** `revoke_code` for ending it. The asymmetry is the
 * point — an approval link going stale is a small inconvenience, while a
 * disable link going stale would strand a parent who wants out.
 */

export enum PublicSharingConsentStatus {
  PENDING_REVIEW = 'pending_review',
  ACTIVE = 'active',
  DECLINED = 'declined',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum PublicSharingRevokedReason {
  /** The parent used the disable link, or asked a coach to. Decision 2. */
  PARENT_REVOKED = 'parent_revoked',
  /**
   * Decision 5: the monthly reminder could not be delivered twice
   * running. An unreachable parent on an account whose media can leave
   * its team means the supervision this design rests on has stopped, so
   * it fails closed rather than staying quietly enabled behind a dead
   * address.
   */
  REMINDER_UNDELIVERABLE = 'reminder_undeliverable',
  /**
   * Present for symmetry with PtPlayerConsent, and not currently set by
   * any code path.
   *
   * It is *intended* that erasure hard-deletes this row via an
   * ON DELETE CASCADE on `player_id`, the way pt_player_consent does.
   * **That constraint does not exist yet** — there is no migration for
   * this table, and the security review (finding 5) caught this comment
   * asserting it as though it did. Until the migration creates the FK,
   * an erased player would leave an orphan row here holding their id, an
   * ACTIVE status and a live revoke code: an incomplete Article 17
   * erasure on the one table recording consent about child media.
   *
   * The migration that creates `public_sharing_consent` MUST carry:
   *   CONSTRAINT "FK_public_sharing_consent_player"
   *     FOREIGN KEY ("player_id") REFERENCES "player"("id")
   *     ON DELETE CASCADE
   */
  ACCOUNT_ERASURE = 'account_erasure',
}

@Entity('public_sharing_consent')
// One row per player. Re-requesting after a decline or a revoke updates
// this row rather than accumulating history: Decision 2 makes re-enabling
// "a fresh grant, not an undo", and a table that answers "is sharing on
// for this child" with one row cannot disagree with itself.
@Index('UQ_public_sharing_consent_player', ['playerId'], { unique: true })
export class PublicSharingConsent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({
    type: 'enum',
    enum: PublicSharingConsentStatus,
    enumName: 'public_sharing_consent_status_enum',
    default: PublicSharingConsentStatus.PENDING_REVIEW,
  })
  status!: PublicSharingConsentStatus;

  /**
   * Grants the consent when followed. Expires, because an approval link
   * sitting in an old inbox should not still work months later.
   */
  @Column({
    name: 'review_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  reviewCode!: string | null;

  @Column({
    name: 'review_code_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  reviewCodeExpiresAt!: Date | null;

  /**
   * Ends it. Deliberately never expires and is reissued on every grant —
   * this is the link in every monthly reminder, and Decision 2 requires
   * that off be reachable "with no confirmation step, no cooling-off
   * period and no email round-trip".
   */
  @Column({
    name: 'revoke_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  revokeCode!: string | null;

  /**
   * The parent address that granted this consent, encrypted at rest and
   * frozen at request time (security review, finding 3).
   *
   * Every later mail — including years of monthly reminders, and the
   * disable link inside them — goes here rather than to whatever the
   * profile says by then. A consent whose notifications follow a changed
   * address is a consent that can be handed to someone else without the
   * person who granted it ever knowing, and the app's own contact-change
   * flow mails its confirmation to the *new* address.
   */
  @Column({
    name: 'recipient_contact_snapshot',
    type: 'text',
    nullable: true,
  })
  recipientContactSnapshot!: string | null;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'declined_at', type: 'timestamptz', nullable: true })
  declinedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({
    name: 'revoked_reason',
    type: 'enum',
    enum: PublicSharingRevokedReason,
    enumName: 'public_sharing_revoked_reason_enum',
    nullable: true,
  })
  revokedReason!: PublicSharingRevokedReason | null;

  /**
   * Decision 6: the reminder is due a month after *this*, not on the 1st
   * for everybody. Set at approval and advanced by each successful send,
   * so a family that opted in on the 20th hears on the 20th.
   */
  @Column({ name: 'last_reminder_at', type: 'timestamptz', nullable: true })
  lastReminderAt!: Date | null;

  /**
   * Consecutive delivery failures, reset to 0 by any success. Decision 5
   * disables at 2. Counting consecutively rather than cumulatively
   * matters: a parent whose mail server had one bad afternoon two years
   * ago should not be one bad afternoon away from losing the consent.
   */
  @Column({ name: 'reminder_failure_count', type: 'int', default: 0 })
  reminderFailureCount!: number;
}
