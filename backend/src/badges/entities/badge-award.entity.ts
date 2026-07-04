import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// `context` is a Postgres jsonb column, but it is NOT a freeform bag — per
// docs/adr/0002-data-model.md's 2026-07-03 addendum §3, it must be a
// BadgeAwardContext discriminated union (see
// src/badges/dto/badge-award-context.dto.ts) validated at the API/DTO
// boundary before ever reaching this column. No badge-award endpoint
// exists yet in Phase 1 (Badges are out of scope per
// docs/api/phase1-contract.md) — this entity + its DTO validator exist so
// the constrained shape is in place before any write path is built,
// exactly the "boring but constrained" discipline the addendum asks for.
@Entity('badge_award')
export class BadgeAward {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'badge_id', type: 'uuid' })
  badgeId!: string;

  @CreateDateColumn({ name: 'awarded_at', type: 'timestamptz' })
  awardedAt!: Date;

  @Column({ type: 'jsonb' })
  context!: Record<string, unknown>;

  // 'system' or a coach's uuid (manual-award case) — plain varchar rather
  // than an FK since 'system' is a valid non-FK sentinel value.
  @Column({ name: 'awarded_by', type: 'varchar' })
  awardedBy!: string;
}
