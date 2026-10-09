import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityType } from '../activity-type.enum';

/**
 * docs/adr/0038 Decision 2 — a server-held countdown. The server stamps
 * `startedAt`, so a client cannot claim a finished 30-minute timer after
 * five seconds. One timer verifies one log (`consumedAt`); at most one is
 * open per player (a partial unique index, see the migration), and starting
 * a new one deletes any unconsumed one.
 *
 * Records *that* a clock ran and *when* — never *where* (CLAUDE.md's
 * no-location constraint). Erased with the player via ON DELETE CASCADE.
 */
@Entity('training_timer')
export class TrainingTimer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({
    name: 'activity_type',
    type: 'enum',
    enum: ActivityType,
    enumName: 'activity_type_enum',
  })
  activityType!: ActivityType;

  @Column({ name: 'planned_minutes', type: 'integer' })
  plannedMinutes!: number;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
