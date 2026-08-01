import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// docs/adr/0018-ai-video-content-tagging.md Decision 4 — a small, closed,
// allow-listed vocabulary, never freeform AI output persisted directly
// (same instinct as PlayerLocale/BadgeAward.context.triggerReason). Exact
// vocabulary is the ADR's own illustrative list, adopted as-is.
export enum VideoClipTagValue {
  SHOOTING = 'shooting',
  STICKHANDLING = 'stickhandling',
  PASSING = 'passing',
  FITNESS_CONDITIONING = 'fitness_conditioning',
  GOALKEEPING = 'goalkeeping',
  TEAM_DRILL = 'team_drill',
  OTHER_TRAINING = 'other_training',
  UNCLEAR_OR_UNRELATED = 'unclear_or_unrelated',
}

// docs/adr/0018-ai-video-content-tagging.md Decision 4 — derived enrichment
// about a clip's content, not embedded as a freeform column on VideoClip
// (a clip can carry zero-to-several tags), and not a freeform-text table
// either (fixed vocabulary only, see VideoClipTagValue above).
//
// ON DELETE CASCADE on clip_id, deliberately different from ClipReport's
// survives-the-clip (ON DELETE SET NULL) pattern (ADR-0010 Decision 5): a
// tag has no independent value once its video is gone — it's pure derived
// enrichment *about* the clip's content, not an accountability record about
// a person's action. Cascading means every existing deletion path that
// already removes a VideoClip row (the 90-day retention sweep, uploader
// self-delete, and the account-erasure walk per ADR-0013) takes its tags
// with it automatically, with no new code path to write.
//
// Internal-only, this phase (ADR-0018 Decision 4): never returned in any
// player-facing API response, never rendered in the Shorts feed UI — exists
// for future backend consumers only (a future badge-award job, a future
// coach/admin review queue). Do not add this entity to any response
// DTO/controller without a new ADR making tags player-visible.
@Entity('video_clip_tag')
@Index('IDX_video_clip_tag_clip_id', ['clipId'])
@Check(
  'CHK_video_clip_tag_confidence_range',
  '"confidence" >= 0 AND "confidence" <= 1',
)
export class VideoClipTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'clip_id', type: 'uuid' })
  clipId!: string;

  @Column({
    type: 'enum',
    enum: VideoClipTagValue,
    enumName: 'video_clip_tag_tag_enum',
  })
  tag!: VideoClipTagValue;

  // Bounded to [0, 1] (a confidence *score*, not a percentage or arbitrary
  // number) via a CHECK constraint below — this table has no app-level
  // validation layer yet (schema-only, no classification service exists
  // to write to it), so the DB is the one place that can cheaply reject a
  // garbage value (e.g. a buggy model emitting NaN or a value outside the
  // range a future consumer's `WHERE confidence > 0.8` filter assumes).
  @Column({ type: 'numeric', precision: 4, scale: 3 })
  confidence!: number;

  // Not an enum, deliberately — new model versions (e.g. 'auto_tagger_v2')
  // get added over time without a schema change (ADR-0018 Decision 4).
  @Column({ type: 'varchar' })
  source!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
