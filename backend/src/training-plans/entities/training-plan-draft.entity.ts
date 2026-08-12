import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TrainingPlanStatus {
  QUEUED = 'queued',
  GENERATING = 'generating',
  READY = 'ready',
  FAILED = 'failed',
}

/**
 * A coach's generated training session (ADR-0028 Phase 1).
 *
 * **Nothing here is about a child.** No `player_id`, no `team_id`, no FK
 * to anything child-scoped — the same structural exclusion ADR-0022
 * Decision 6 made for ErrorLogEntry, with the same consequence: this table
 * needs no entry in ADR-0013's per-entity erasure table, because there is
 * nothing about a child in it to erase. The only subject it has is the
 * adult who asked, and `ON DELETE CASCADE` from `staff_account` handles
 * them.
 *
 * `prompt_text` is the one field a coach could misuse by typing a child's
 * name into it. ADR-0028 Decision 7(c) names that residual rather than
 * pretending it away; what stops it becoming systemic is that the request
 * DTO carries this plus four enums and **has no field capable of holding
 * roster, streak or team data**, and no code path enriches it.
 */
@Entity('training_plan_draft')
@Index('IDX_training_plan_draft_owner', ['staffAccountId', 'createdAt'])
export class TrainingPlanDraft {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'staff_account_id', type: 'uuid' })
  staffAccountId!: string;

  /** What the adult typed. Never enriched by this app. */
  @Column({ name: 'prompt_text', type: 'varchar', length: 1000 })
  promptText!: string;

  /** Reuses the drill library's bands — an age range, never a birth date. */
  @Column({ name: 'age_band', type: 'varchar', length: 16 })
  ageBand!: string;

  @Column({ name: 'duration_minutes', type: 'smallint' })
  durationMinutes!: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  focus!: string | null;

  @Column({ type: 'varchar', length: 8, default: 'sv' })
  locale!: string;

  @Column({
    type: 'enum',
    enum: TrainingPlanStatus,
    enumName: 'training_plan_status_enum',
    default: TrainingPlanStatus.QUEUED,
  })
  status!: TrainingPlanStatus;

  @Column({ name: 'generated_plan', type: 'text', nullable: true })
  generatedPlan!: string | null;

  @Column({ name: 'model_id', type: 'varchar', length: 128, nullable: true })
  modelId!: string | null;

  /**
   * Which drills were in the prompt. The corpus is version-controlled, so
   * a plan can always be traced to the material it was built from — the
   * same provenance reasoning VideoClipTag.source uses.
   */
  @Column({
    name: 'corpus_version',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  corpusVersion!: string | null;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  /** The generator is handed this, never the draft id — same reasoning as
   *  the clip-tagging lease, though the stakes are lower here since no
   *  frame of anyone's video is involved. */
  @Column({ name: 'lease_id', type: 'uuid', nullable: true })
  leaseId!: string | null;

  @Column({ name: 'leased_until', type: 'timestamptz', nullable: true })
  leasedUntil!: Date | null;

  /** Shown to the coach. A fixed phrase, never a model or stack detail. */
  @Column({
    name: 'failure_reason',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  failureReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
