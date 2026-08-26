import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TrainerPostStatus {
  PENDING_REVIEW = 'pending_review',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
}

/**
 * A tip published by a trainer, readable by anyone using the app.
 *
 * **This is content flowing IN to children, not children's data flowing
 * out.** The closed-team-bubble rule protects the second; this is the
 * first, and the two need different controls. What matters here is not
 * "who may see this" but "who put it in front of a child" — hence an
 * operator review before anything is visible, recorded on the row.
 *
 * The subject of a post is its author. There is no player, no team, no
 * clip, and no column one could be added to without an obvious diff.
 */
@Entity('trainer_post')
@Index('IDX_trainer_post_author', ['authorStaffAccountId', 'createdAt'])
export class TrainerPost {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'author_staff_account_id', type: 'uuid' })
  authorStaffAccountId!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  /** Plain text. Rendered escaped, never parsed as markup. */
  @Column({ type: 'text' })
  body!: string;

  /**
   * How the author wants to be known to readers.
   *
   * Deliberately not the account's display name. Publishing under your
   * own name to an audience of children is a choice, and it should be
   * made once, explicitly, rather than inherited from whatever the SSO
   * provider happened to return at sign-in.
   */
  @Column({ name: 'author_byline', type: 'varchar', length: 80 })
  authorByline!: string;

  @Column({ type: 'varchar', length: 8, default: 'sv' })
  locale!: string;

  @Column({ name: 'age_band', type: 'varchar', length: 16, nullable: true })
  ageBand!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  focus!: string | null;

  /**
   * How long this takes to do, in minutes.
   *
   * The field that makes a post a drill rather than a tip (owner's ask,
   * 2026-08-26). Nullable because a tip that is not a timed session has
   * no honest answer, and because every row predating it has none.
   */
  @Column({ name: 'duration_minutes', type: 'smallint', nullable: true })
  durationMinutes!: number | null;

  @Column({
    type: 'enum',
    enum: TrainerPostStatus,
    enumName: 'trainer_post_status_enum',
    default: TrainerPostStatus.PENDING_REVIEW,
  })
  status!: TrainerPostStatus;

  /**
   * Who let this onto children's screens.
   *
   * The operator review IS the control here — there is no automated
   * judgement of whether a tip is appropriate for a nine-year-old, and
   * pretending otherwise would be worse than admitting it. So this FK is
   * SET NULL rather than CASCADE: a *reviewer* leaving must not delete
   * the evidence that a review happened.
   *
   * **That guarantee is narrower than it reads, and the narrowing is not
   * intentional.** `author_staff_account_id` is ON DELETE CASCADE (see
   * the migration), so if the departing operator is the post's *author*,
   * the whole row goes — this column with it. The evidence survives a
   * reviewer leaving, not an author leaving.
   *
   * Not reachable today: nothing in the backend deletes a `staff_account`
   * row, so it needs direct database action. But ADR-0023 Decision A7
   * treats clean staff-account deletion as a designed operation, so this
   * is a gap to close before that is built — either by making the author
   * FK SET NULL too (the post survives; `author_byline` is already
   * denormalised, so it stays readable) or by saying plainly that
   * deleting an author deletes their posts. Found by the comment audit,
   * 2026-08-17.
   */
  @Column({
    name: 'reviewed_by_staff_account_id',
    type: 'uuid',
    nullable: true,
  })
  reviewedByStaffAccountId!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  /** Shown to the author so a rejection is actionable, never to readers. */
  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  rejectionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /**
   * ADR-0035 Decision 3 — non-null means this post's text began as a
   * model draft rather than as something a trainer typed.
   *
   * The column exists for the **reviewer**, not for bookkeeping: a person
   * working through a queue reads human-written and machine-drafted text
   * differently, and should be able to tell which is which. The operator
   * review is the only control between this table and a child's screen,
   * and hiding the distinction would degrade it.
   *
   * `ON DELETE SET NULL` (see the migration): ADR-0028 Decision 7's sweep
   * deletes old drafts, and a published post must outlive its source.
   *
   * What a child reader is told — if anything — is deliberately NOT
   * decided by this column's existence. ADR-0035 leaves that to
   * ux-designer and the project owner, and notes that silence is also a
   * choice.
   */
  @Column({
    name: 'source_training_plan_draft_id',
    type: 'uuid',
    nullable: true,
  })
  sourceTrainingPlanDraftId!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
