import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityType } from '../activity-type.enum';
import { EvidenceTier } from '../points.util';

// The "Jag har tränat" event — append-only source of truth for everything
// derived from it (streaks, team pool, later challenge progress). Never
// records *where* it happened, only *that* it happened and *when* (see
// CLAUDE.md's no-location-tracking constraint).
@Entity('training_log_entry')
@Index(['playerId', 'loggedAt'])
@Index(['teamId'])
export class TrainingLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  // Denormalized from Player.team_id — team-scoped queries (pool, coach
  // dashboard) are extremely common, per ADR-0002.
  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'logged_at', type: 'timestamptz' })
  loggedAt!: Date;

  @Column({
    name: 'activity_type',
    type: 'enum',
    enum: ActivityType,
    enumName: 'activity_type_enum',
  })
  activityType!: ActivityType;

  @Column({ name: 'duration_minutes', type: 'integer' })
  durationMinutes!: number;

  // Nullable FK — the column exists per ADR-0002/the Phase 1 contract, even
  // though Challenge management endpoints don't exist yet (Phase 2). Not
  // consumed by any logic in Phase 1.
  /**
   * docs/adr/0025 — the clip offered as proof of this session, if any.
   * ON DELETE SET NULL, deliberately: deleting a clip never claws back
   * points already awarded (that would make deletion, a right this app
   * makes unconditional, feel costly), so the FK goes null while
   * `evidenceTier` below preserves what was actually earned.
   */
  @Column({ name: 'evidence_clip_id', type: 'uuid', nullable: true })
  evidenceClipId!: string | null;

  /**
   * The tier this log was paid at. **Stored, not derived** — recomputing it
   * from `evidenceClipId` would silently re-rate every historical log the
   * moment a clip was deleted or the multipliers were retuned.
   */
  @Column({
    name: 'evidence_tier',
    type: 'enum',
    enum: EvidenceTier,
    enumName: 'training_log_evidence_tier_enum',
    default: EvidenceTier.CLICK_ONLY,
  })
  evidenceTier!: EvidenceTier;

  @Column({ name: 'challenge_id', type: 'uuid', nullable: true })
  challengeId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
