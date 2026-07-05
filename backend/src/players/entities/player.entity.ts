import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ParentalConsentStatus } from '../player-consent-status.enum';

// Deliberately does NOT include real_name or parent_contact — those live in
// PlayerPrivateInfo (see docs/adr/0002-data-model.md's 2026-07-03 addendum
// §1). Nothing in this entity/table is off-limits for an ordinary
// leaderboard/feed/badge query, by construction.
@Entity('player')
@Index(['teamId', 'screenName'], { unique: true })
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'screen_name', type: 'varchar' })
  screenName!: string;

  @Column({ name: 'avatar_id', type: 'varchar' })
  avatarId!: string;

  // Year only — never a full date of birth, per ADR-0002 (coarse enough for
  // age-banded challenge targeting without being unnecessarily precise on a
  // child).
  @Column({ name: 'birth_year', type: 'smallint' })
  birthYear!: number;

  @Column({
    name: 'parental_consent_status',
    type: 'enum',
    enum: ParentalConsentStatus,
    enumName: 'parental_consent_status_enum',
    default: ParentalConsentStatus.PENDING,
  })
  parentalConsentStatus!: ParentalConsentStatus;

  // Denormalized streak fields, kept in sync with TrainingLogEntry inserts
  // in the same Postgres transaction (see TrainingLogsService) — durable so
  // "longest streak ever" survives a Redis flush/restart, per ADR-0002.
  @Column({ name: 'current_streak_count', type: 'integer', default: 0 })
  currentStreakCount!: number;

  @Column({ name: 'longest_streak_count', type: 'integer', default: 0 })
  longestStreakCount!: number;

  @Column({ name: 'last_trained_date', type: 'date', nullable: true })
  lastTrainedDate!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // No location field of any kind, per CLAUDE.md's non-negotiable
  // constraints — do not add one here.
}
