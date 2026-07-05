import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityType } from '../activity-type.enum';

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
  @Column({ name: 'challenge_id', type: 'uuid', nullable: true })
  challengeId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
