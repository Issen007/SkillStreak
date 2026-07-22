import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ClipReportReason {
  APPEARS_WITHOUT_CONSENT = 'appears_without_consent',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  NOT_TRAINING_RELATED = 'not_training_related',
  BULLYING = 'bullying',
  OTHER = 'other',
}

// docs/adr/0010-video-storage-and-serving.md Decision 4/5 — an append-only
// audit trail, same rationale as TeamChatMessageReport, but with one
// structural difference: `clip_id` is nullable, ON DELETE SET NULL (see the
// migration), because a report must outlive the clip it reported (self-
// delete or expiry) — the accountability record ("this player was
// reported, for this reason, on this date") survives independently.
// `reported_uploader_player_id` is denormalized at write time for exactly
// that reason: once clip_id goes null, this column is the only remaining
// link back to who was reported.
//
// **No response anywhere returns rows from this table to any player** —
// not to the reported player, not to the team, not even a count; only a
// per-viewer `reportedByMe: boolean` on the feed response is ever derived
// from it (same anonymity guarantee as ADR-0007 Decision 1).
@Entity('clip_report')
@Index('UQ_clip_report_clip_reporter', ['clipId', 'reporterPlayerId'], {
  unique: true,
})
export class ClipReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'clip_id', type: 'uuid', nullable: true })
  clipId!: string | null;

  @Column({ name: 'reporter_player_id', type: 'uuid' })
  reporterPlayerId!: string;

  // Denormalized at write time (ADR-0010 Decision 5) — survives clip_id
  // going null when the clip is later deleted.
  @Column({ name: 'reported_uploader_player_id', type: 'uuid' })
  reportedUploaderPlayerId!: string;

  @Column({
    type: 'enum',
    enum: ClipReportReason,
    enumName: 'clip_report_reason_enum',
  })
  reason!: ClipReportReason;

  @Column({ type: 'varchar', length: 140, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
