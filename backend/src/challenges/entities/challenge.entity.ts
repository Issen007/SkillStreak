import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum ChallengeStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// Modeled now (per ADR-0002) because TrainingLogEntry.challenge_id already
// references it, even though Challenge CRUD/assignment endpoints are Phase
// 2 (Fas 2) work — see docs/api/phase1-contract.md's "out of scope" note.
// No service/controller for this entity in Phase 1, just the table + FK.
@Entity('challenge')
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ name: 'created_by_coach_id', type: 'uuid' })
  createdByCoachId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ name: 'target_metric', type: 'varchar' })
  targetMetric!: string;

  @Column({ name: 'target_value', type: 'integer' })
  targetValue!: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: ChallengeStatus,
    enumName: 'challenge_status_enum',
    default: ChallengeStatus.DRAFT,
  })
  status!: ChallengeStatus;
}
