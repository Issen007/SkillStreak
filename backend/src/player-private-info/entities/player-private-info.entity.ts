import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// Per docs/adr/0002-data-model.md's 2026-07-03 addendum §1: real_name and
// parent_contact live here, structurally isolated from Player, so an
// ordinary query against Player (leaderboard, feed, badge lookups, a
// careless future `SELECT *`) cannot return this data. Only
// PlayerPrivateInfoModule may import this entity/repository — see that
// module's file for the enforced boundary.
@Entity('player_private_info')
export class PlayerPrivateInfo {
  // One-to-one with Player via a shared primary key (player_id), not a
  // surrogate id — there is exactly one private-info row per player, ever.
  @PrimaryColumn({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  // Optional — some teams/parents will prefer not to store it at all.
  @Column({ name: 'real_name', type: 'varchar', nullable: true })
  realName!: string | null;

  // Required — needed to run the consent flow (who do we ask for approval).
  @Column({ name: 'parent_contact', type: 'varchar' })
  parentContact!: string;

  // docs/adr/0012-profile-page-and-contact-email-change.md — the pending
  // new value during a contact-email change, encrypted the same way
  // parentContact is (ADR-0011); only ever copied into parentContact once
  // contactChangeCode is redeemed, never read/decrypted on its own except
  // by that one confirm step.
  @Column({ name: 'pending_parent_contact', type: 'varchar', nullable: true })
  pendingParentContact!: string | null;

  // Deliberately NOT encrypted — same precedent as Player
  // .sessionReissueCode (ADR-0004 Part 3): needs an exact-match equality
  // lookup, which a nondeterministic-IV encrypted value can't support;
  // protected by single-use + short TTL, not encryption at rest.
  @Column({
    name: 'contact_change_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  contactChangeCode!: string | null;

  @Column({
    name: 'contact_change_code_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  contactChangeCodeExpiresAt!: Date | null;

  // security-reviewer finding, 2026-07-28 (docs/adr/0012's addendum):
  // confirming via the new-address code no longer applies the change
  // immediately — it starts a grace period. Set only once the new-address
  // code is confirmed; null means either no change is pending, or one is
  // pending but not yet confirmed (still waiting on the new-address code).
  @Column({
    name: 'contact_change_apply_at',
    type: 'timestamptz',
    nullable: true,
  })
  contactChangeApplyAt!: Date | null;

  // Sent to the OLD address once the new-address code is confirmed (not
  // at request time — there's nothing concrete to cancel until then).
  // Deliberately NOT encrypted, same reasoning as contactChangeCode.
  // Redeeming this before contactChangeApplyAt cancels the pending change
  // entirely and bumps Player.token_version (see
  // SessionService-equivalent reasoning) — the old address holder saying
  // "this wasn't me" is exactly the moment forcing a fresh login is
  // warranted.
  @Column({
    name: 'contact_change_cancel_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  contactChangeCancelCode!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
