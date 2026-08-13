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
 * **This table can contain a child's name, and the erasure story must
 * not pretend otherwise.**
 *
 * An earlier version of this comment said "nothing here is about a
 * child … it needs no entry in ADR-0013's erasure table", and then
 * conceded four lines later that a coach can type a name into
 * `prompt_text`. Both cannot be true, and a security review called it:
 * ADR-0028 Decision 7(c) treats "give me a session for Erik who is
 * struggling with backhand" as expected, not hypothetical, and
 * `generated_plan` repeats the prompt back.
 *
 * What is actually true, stated as three separate facts:
 *
 * 1. **The app never puts a child in a prompt.** The request DTO is
 *    `promptText` plus four enums, and `leaseNext` builds the job from
 *    that row plus the adult-authored drill library. There is no
 *    enrichment path and no code that could add roster, streak or team
 *    data. This control is real and it is the important one.
 * 2. **A coach can still type a name.** Nothing structural prevents it.
 *    The UI now says not to, and the coach can delete a plan — those are
 *    the mitigations ADR-0028 Decision 7(c) asks for, and they are
 *    weaker than a structural control because they depend on a person.
 * 3. **Erasure cannot find such a name.** There is no `player_id` to
 *    search on, by design. So a name typed here is removed by the
 *    coach's own delete or by the retention sweep, and by nothing else.
 *    That is a real gap, it is written down here rather than in a
 *    comment claiming the opposite, and it is why the retention window
 *    matters more for this table than its "adult work product" framing
 *    first suggests.
 *
 * The absence of `player_id` and `team_id` is still deliberate and still
 * right — it keeps the table out of every join that could turn it into a
 * profile. It just does not mean the table is child-free.
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
