import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A3 — Part A's "step
// 2" table: the per-relationship, mailed review-and-approve consent gate,
// structurally reusing ADR-0019's ClipPublicationRequest pattern (a
// review_code for granting, a separate, deliberately non-expiring
// revoke_code for ending it) adapted for a non-media approval. Every row
// traces back to the specific PtTeamLink it was requested under
// (pt_team_link_id) — that FK is exactly what makes Decision A4's
// team-level cascade-revoke correct: revoking a PtTeamLink cascades to
// every PtPlayerConsent rooted under it.
export enum PtPlayerConsentStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  DECLINED = 'declined',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum PtPlayerConsentRevokedReason {
  PARENT_OR_PLAYER_REVOKED = 'parent_or_player_revoked',
  TEAM_LINK_REVOKED = 'team_link_revoked',
  // Named in the ADR's schema for completeness (matches its Decision A3
  // text verbatim) but never actually set by any code path in this
  // codebase: PtPlayerConsent.player_id is ON DELETE CASCADE (see the
  // migration) — a player's own account erasure hard-deletes this row
  // outright (docs/adr/0023 "Interaction with ADR-0013"), it never
  // survives as a revoked row carrying this reason.
  ACCOUNT_ERASURE = 'account_erasure',
}

@Entity('pt_player_consent')
export class PtPlayerConsent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'pt_team_link_id', type: 'uuid' })
  ptTeamLinkId!: string;

  // Denormalized from pt_team_link — query convenience only, same
  // TrainingLogEntry.team_id-style pattern ADR-0002 already establishes.
  @Column({ name: 'pt_staff_account_id', type: 'uuid' })
  ptStaffAccountId!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({
    type: 'enum',
    enum: PtPlayerConsentStatus,
    enumName: 'pt_player_consent_status_enum',
    default: PtPlayerConsentStatus.PENDING_REVIEW,
  })
  status!: PtPlayerConsentStatus;

  // Single-use, mailed at request time — generateHumanCode, the same
  // utility every mailed-code flow in this app already reuses. 7-day TTL
  // (see pt.constants.ts), matching ClipPublicationRequest's own
  // reasoning: this is at least as weighty a read as approving a clip.
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

  // Minted only at approval time, deliberately NON-expiring (Decision A4 —
  // revocation must always be available, unlike granting, which needs a
  // freshness window). Separate from review_code on purpose.
  @Column({
    name: 'revoke_code',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  revokeCode!: string | null;

  // Encrypted (AES-256-GCM, common/crypto/pii-encryption.util.ts, ADR-0011)
  // — the exact contact-change-hijack-race fix from ADR-0013 Decision 2 /
  // ADR-0019, reused verbatim: PtConsentService checks
  // PlayerPrivateInfoService.hasPendingContactChange(playerId) before
  // creating this row, calls getParentContact() exactly once, and
  // snapshots the resolved value here — never re-resolved for this row's
  // lifetime.
  @Column({
    name: 'recipient_contact_snapshot',
    type: 'varchar',
    nullable: true,
  })
  recipientContactSnapshot!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({
    name: 'revoked_reason',
    type: 'enum',
    enum: PtPlayerConsentRevokedReason,
    enumName: 'pt_player_consent_revoked_reason_enum',
    nullable: true,
  })
  revokedReason!: PtPlayerConsentRevokedReason | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // "One active (pending_review/approved) row per (pt_staff_account_id,
  // player_id)" — enforced by a partial unique index (see the migration),
  // identical mechanism to ClipPublicationRequest's own single-active-row
  // invariant.
}
