import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AccountErasureStatus {
  REQUESTED = 'requested',
  GRACE_PERIOD = 'grace_period',
  CANCELLED = 'cancelled',
  EXECUTED = 'executed',
}

// docs/adr/0013-account-erasure.md Decision 1 — the durable audit trail for
// self-service GDPR account erasure. Deliberately outlives the Player/Team
// rows it's about (the whole point: once erasure executes, Player is gone),
// so player_id/team_id/successor_player_id are plain UUID columns, NOT
// FKs — a real FK would force an ON DELETE choice that's either pointless
// (CASCADE — the audit row vanishes exactly when the thing it's auditing
// does) or backwards (RESTRICT/blocks the very deletion this row exists to
// track). An orphaned UUID, meaningless on its own once the referenced row
// is gone, is exactly the right amount of durability here — same category
// of "intentionally soft reference" as BadgeAward.awardedBy's 'system'
// sentinel.
//
// Deliberately does NOT denormalize screen_name/real_name/any identifying
// field onto this row — an erasure audit log that itself becomes a
// permanent copy of the erased identity would quietly recreate the exact
// data-retention problem this feature exists to solve. Every caller that
// needs a screen name for an email/page (AccountErasureService,
// AccountErasureSweepService) re-reads it live from Player — always before
// execution, while the player row still exists.
//
// Only one ACTIVE (requested/grace_period) row per player_id at a time —
// enforced by a partial unique index (see the
// AddAccountErasure migration), the same mechanism
// idx_player_one_captain_per_team uses for its own single-active-row
// invariant.
@Entity('account_erasure_request')
export class AccountErasureRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  // Encrypted (AES-256-GCM, common/crypto/pii-encryption.util.ts — the same
  // utility PlayerPrivateInfo uses, ADR-0011). Resolved via
  // PlayerPrivateInfoService.getParentContact exactly once, at request
  // time (ADR-0013 Decision 2's contact-change-race fix) — never
  // re-resolved for the rest of this row's lifecycle. Both the request-time
  // confirm-code email and the confirm-time cancel-link email go to this
  // one snapshotted value.
  @Column({
    name: 'recipient_contact_snapshot',
    type: 'varchar',
    nullable: true,
  })
  recipientContactSnapshot!: string | null;

  // Locked in at confirm time (re-validated there: still on the team, not
  // itself mid-erasure) — see ADR-0013 Decision 4. No FK, same reasoning as
  // player_id/team_id above.
  @Column({ name: 'successor_player_id', type: 'uuid', nullable: true })
  successorPlayerId!: string | null;

  @Column({
    type: 'enum',
    enum: AccountErasureStatus,
    enumName: 'account_erasure_request_status_enum',
    default: AccountErasureStatus.REQUESTED,
  })
  status!: AccountErasureStatus;

  // Single-use, 24h TTL, mailed at request time. Nulled once redeemed
  // (AccountErasureService.confirmErasure) — mirrors
  // PlayerPrivateInfo.contactChangeCode's null-on-use idiom.
  @Column({
    name: 'confirm_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  confirmCode!: string | null;

  @Column({
    name: 'confirm_code_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  confirmCodeExpiresAt!: Date | null;

  // Grace-period clock start — set only once the confirm code is redeemed
  // (ADR-0013 Decision 2's "confirm-gates-the-clock" resolution).
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  // confirmed_at + 30 days. The scheduled sweep (AccountErasureSweepService)
  // only ever selects grace_period rows with this in the past.
  @Column({ name: 'scheduled_for', type: 'timestamptz', nullable: true })
  scheduledFor!: Date | null;

  // Single-use, valid the whole 30-day grace period — no separate expiry
  // column; liveness is simply "status is still grace_period." Nulled on
  // use (cancellation), same idiom as confirm_code above.
  @Column({
    name: 'cancel_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  cancelCode!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
