import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// docs/adr/0023-pt-role-and-staff-sso-rbac.md Decision A2 — Part A's
// "step 1" table: a captain-generated, short-lived team-invite code
// (never persisted here — see PtTeamLinksService/RedisService, single-use,
// 24h TTL, stored in Redis, not a 4th new table per the ADR's own
// Consequences list) redeemed by an already-authenticated `pt`-role
// StaffAccount. On its own, an active row here grants ONLY the
// team-aggregate tier (Decision A5's first table) — screen names + each
// player's PT-consent status — never any individual child's training
// data. That requires a separate, per-player PtPlayerConsent row (see that
// entity), always rooted back to a specific PtTeamLink via
// pt_team_link_id, which is exactly what makes Decision A4's team-level
// cascade-revoke correct: revoking this row cascades to every
// PtPlayerConsent that traces back to it.
export enum PtTeamLinkStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

@Entity('pt_team_link')
export class PtTeamLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'pt_staff_account_id', type: 'uuid' })
  ptStaffAccountId!: string;

  // The captain who generated the invite code — kept for audit ("who
  // brought this PT in"). ON DELETE SET NULL (not cascaded) if that player
  // later erases their own account: the link (and every consent under it)
  // outlives the specific captain's tenure, the same "detach the identity,
  // keep the row" pattern Challenge.createdByPlayerId already established
  // per ADR-0013 Decision 6.
  @Column({ name: 'invited_by_player_id', type: 'uuid', nullable: true })
  invitedByPlayerId!: string | null;

  @Column({
    type: 'enum',
    enum: PtTeamLinkStatus,
    enumName: 'pt_team_link_status_enum',
    default: PtTeamLinkStatus.ACTIVE,
  })
  status!: PtTeamLinkStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  // "One active link per (team, PT) pair — re-inviting after a revoke
  // creates a new row, preserving the old one as history" — enforced by a
  // partial unique index (see the AddPtTeamLinkAndPlayerConsent
  // migration), the same mechanism idx_player_one_captain_per_team/
  // idx_account_erasure_request_one_active_per_player already use for
  // their own single-active-row invariants.
}
