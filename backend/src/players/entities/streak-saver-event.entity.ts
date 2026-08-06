import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StreakSaverEventType } from '../streak-saver-event-type.enum';

// Append-only audit trail behind `Player.banked_streak_saver_count` — same
// "denormalized counter for fast reads, backed by an append-only event
// table for history" pattern as TrainingLogEntry behind the streak
// counters, or ParentalConsentRecord behind consent status
// (docs/adr/0024-streak-savers.md Decision 4). Never updated or deleted,
// only inserted into, always from inside TrainingLogsService.logTraining's
// existing transaction (PlayersService.updateStreakFields).
//
// One row per saver, not one row per resolution: a 3-day gap bridged by 3
// banked savers writes 3 'spent' rows (one covered_date each), matching how
// 'earned' rows already work (1 row per 7-day milestone).
//
// Deliberately NOT reusing TrainingLogEntry for a covered gap — a saver
// spend is not a training event (no activity happened on the covered day)
// and must never be mistaken for one (Decision 6). No synthetic/backdated
// TrainingLogEntry is ever written for a covered day.
@Entity('streak_saver_event')
@Index(['playerId', 'createdAt'])
export class StreakSaverEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: StreakSaverEventType,
    enumName: 'streak_saver_event_type_enum',
  })
  eventType!: StreakSaverEventType;

  // The banked balance immediately after this one event — lets "why do I
  // only have 1 saver left" be answered from history alone.
  @Column({ name: 'banked_balance_after', type: 'integer' })
  bankedBalanceAfter!: number;

  // Only set for event_type = 'earned' — the log whose insertion crossed
  // the 7-day milestone that earned this saver.
  @Column({ name: 'training_log_entry_id', type: 'uuid', nullable: true })
  trainingLogEntryId!: string | null;

  // Only set for event_type = 'spent' — the missed calendar day this one
  // saver covered ('YYYY-MM-DD', Europe/Stockholm calendar day, same
  // representation as Player.last_trained_date).
  @Column({ name: 'covered_date', type: 'date', nullable: true })
  coveredDate!: string | null;

  // Only set for event_type = 'spent' — the log whose insertion actually
  // resolved (bridged) the gap this saver covered.
  @Column({
    name: 'resolved_by_training_log_entry_id',
    type: 'uuid',
    nullable: true,
  })
  resolvedByTrainingLogEntryId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
