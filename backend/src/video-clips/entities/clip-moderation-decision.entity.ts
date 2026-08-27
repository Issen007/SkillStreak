import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ClipModerationDecisionKind {
  /** The report was right: the clip stays hidden. */
  UPHELD = 'upheld',
  /** The report was wrong or does not warrant hiding: the clip goes back. */
  DISMISSED = 'dismissed',
}

/**
 * docs/design/clip-safety.md layer 4 — what an operator decided about a
 * reported clip, as an event rather than a flag.
 *
 * **A history, deliberately.** A clip can be reported, dismissed, and
 * reported again by a different teammate with a better reason. Each of
 * those is a separate judgement, and a single status column on the clip
 * would overwrite the earlier one — losing exactly the record that
 * matters if anyone later asks what was known and when.
 *
 * Says nothing about who reported: that lives in `clip_report`, and its
 * anonymity guarantee (no response anywhere returns a reporter to any
 * player) is unchanged by this table's existence.
 */
@Entity('clip_moderation_decision')
@Index('IDX_clip_moderation_decision_clip', ['clipId', 'createdAt'])
export class ClipModerationDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Nullable, ON DELETE SET NULL — the same reasoning `clip_report.clip_id`
   * already carries: the record that a judgement was made must outlive the
   * clip it was about, including a self-delete or a retention expiry.
   */
  @Column({ name: 'clip_id', type: 'uuid', nullable: true })
  clipId!: string | null;

  /** SET NULL too: an operator leaving must not erase their decisions. */
  @Column({
    name: 'decided_by_staff_account_id',
    type: 'uuid',
    nullable: true,
  })
  decidedByStaffAccountId!: string | null;

  @Column({
    type: 'enum',
    enum: ClipModerationDecisionKind,
    enumName: 'clip_moderation_decision_kind_enum',
  })
  decision!: ClipModerationDecisionKind;

  /** Operator-facing only. Never returned to any player. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
