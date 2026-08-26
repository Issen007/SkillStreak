import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum VideoClipStatus {
  PENDING_UPLOAD = 'pending_upload',
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
}

// docs/adr/0018-ai-video-content-tagging.md Decision 5 — tracks the
// best-effort, non-blocking auto-tagging job's outcome only; never affects
// playback, feed visibility, or any user-facing state. `not_processed` is
// the default for every existing and newly-created row; a background job
// (not built by this schema-only change) is expected to move a `published`
// row through this once the classifier exists.
export enum VideoClipTaggingStatus {
  NOT_PROCESSED = 'not_processed',
  TAGGED = 'tagged',
  NO_CONFIDENT_TAGS = 'no_confident_tags',
  FAILED = 'failed',
}

// docs/adr/0010-video-storage-and-serving.md — the highest child-safety-risk
// entity in this app so far: a row never carries the video bytes themselves
// (those live in MinIO, see ObjectStorageService), only the metadata needed
// to structurally scope/serve/expire them. `team_id` is denormalized at
// upload time (identical pattern to TrainingLogEntry.team_id/
// TeamChatMessage.team_id) — a clip belongs, permanently, to the team it was
// posted to, not derived from the uploader's *current* team, so a later
// roster change never moves or hides it retroactively (Decision 5).
//
// `storage_key` is server-generated (`clips/{teamId}/{clipId}.{ext}`) and
// NEVER accepted from a client on any endpoint (docs/api/phase3-contract.md
// implementer note) — it's also never returned in any response; clients
// only ever see presigned uploadUrl/playbackUrl.
/**
 * docs/design/clip-safety.md layer 3 — whether an operator has watched
 * this clip. NULL means nobody ever asked for it to be public.
 */
export enum PublicClipReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('video_clip')
@Index('IDX_video_clip_team_status_created_at', [
  'teamId',
  'status',
  'createdAt',
])
@Index('IDX_video_clip_status_expires_at', ['status', 'expiresAt'])
export class VideoClip {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  // ON DELETE CASCADE at the DB level (see the AddAccountErasure
  // migration) — a BACKSTOP only, per docs/adr/0013-account-erasure.md
  // Decision 6: AccountErasureService always deletes the MinIO object,
  // then this row, explicitly in application code first (Postgres cascade
  // can never reach object storage), so this FK just guarantees the row
  // can't get stuck if the app-level walk ever misses one. Was RESTRICT
  // before this ADR ("no player-deletion feature exists yet").
  @Column({ name: 'uploader_player_id', type: 'uuid' })
  uploaderPlayerId!: string;

  // "Tag a teammate to challenge them" (ADR-0010 Decision 3) — an ordinary
  // FK reference, not a claim about who appears on camera. ON DELETE SET
  // NULL (unlike uploader_player_id): the clip itself is the uploader's
  // content and should never be silently orphaned, but a stale tag
  // referencing a since-removed player is fine to just clear.
  @Column({ name: 'tagged_player_id', type: 'uuid', nullable: true })
  taggedPlayerId!: string | null;

  // Server-generated (ADR-0010 Decision 1) — never client-supplied, never
  // returned in any API response.
  @Column({ name: 'storage_key', type: 'varchar', unique: true })
  storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar' })
  mimeType!: string;

  // Client-declared at upload-url time; spot-checked (not deeply
  // re-verified) against MinIO's own HEAD response at `complete`
  // (ADR-0010 Decision 3's "technical validity" check). Plain `integer`
  // (not `bigint`) is deliberate — the ~25MB cap comfortably fits a 32-bit
  // int, and `bigint` columns come back from `pg` as strings, which would
  // force every caller to coerce this field back to a number.
  @Column({ name: 'file_size_bytes', type: 'integer' })
  fileSizeBytes!: number;

  @Column({ name: 'duration_seconds', type: 'integer' })
  durationSeconds!: number;

  @Column({
    name: 'caption',
    type: 'varchar',
    length: 140,
    nullable: true,
  })
  caption!: string | null;

  @Column({
    type: 'enum',
    enum: VideoClipStatus,
    enumName: 'video_clip_status_enum',
    default: VideoClipStatus.PENDING_UPLOAD,
  })
  status!: VideoClipStatus;

  // Set once, at upload-url time — the anchor both the feed's ordering and
  // expires_at's calculation (createdAt + retention window) are based on,
  // per ADR-0010 Decision 5.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Null while pending_upload/hidden's origin is still pending_upload; set
  // exactly once, at `complete`, to createdAt + the retention window
  // (ADR-0010 Decision 5). The daily retention sweep only ever queries rows
  // with a non-null, past expiresAt — a pending_upload row has no
  // expiresAt by design (it's covered by the separate, shorter TTL sweep
  // instead, keyed off createdAt, not this column).
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  // docs/adr/0018-ai-video-content-tagging.md Decision 5 — internal-only,
  // never exposed in any client-facing response/DTO (see VideoClipTag for
  // the corresponding tag rows). Not indexed yet: no background sweep
  // queries on this column exists in this schema-only change; add one
  // (mirroring IDX_video_clip_status_expires_at's shape) alongside whatever
  // job is built to consume it.
  @Column({
    name: 'tagging_status',
    type: 'enum',
    enum: VideoClipTaggingStatus,
    enumName: 'video_clip_tagging_status_enum',
    default: VideoClipTaggingStatus.NOT_PROCESSED,
  })
  taggingStatus!: VideoClipTaggingStatus;

  // The lease that lets the GPU cluster pull this clip's frames without
  // ever learning which clip they came from (migration
  // AddClipTaggingLease). `tagging_lease_id` is what the worker is handed
  // in place of `id`; a compromised worker holds no identifier that means
  // anything here.
  //
  // Never exposed in any client-facing response or DTO, exactly like
  // `tagging_status` and `storage_key`.
  @Column({ name: 'tagging_attempts', type: 'smallint', default: 0 })
  taggingAttempts!: number;

  @Column({ name: 'tagging_lease_id', type: 'uuid', nullable: true })
  taggingLeaseId!: string | null;

  @Column({
    name: 'tagging_leased_until',
    type: 'timestamptz',
    nullable: true,
  })
  taggingLeasedUntil!: Date | null;

  // docs/adr/0021-clip-challenge-notifications.md Decision 1 — the "tag a
  // teammate to challenge them" video-clip feature's own acknowledgement
  // state. DISTINCT from the `Challenge` entity (src/challenges/), which is
  // ADR-0005's weekly team goal ("veckans mål") — that ADR explicitly
  // anticipated this exact naming overlap and this column is the resolution
  // it predicted; don't merge the two concepts. NULL means "still a pending
  // challenge for taggedPlayerId," set exactly once (by the tagged player,
  // via POST .../clips/:clipId/challenge-ack) and only ever meaningful when
  // taggedPlayerId IS NOT NULL AND status = 'published' — the same
  // "meaningless outside its one real context" shape as
  // Challenge.goalBonusAwardedAt.
  @Column({
    name: 'challenge_acknowledged_at',
    type: 'timestamptz',
    nullable: true,
  })
  challengeAcknowledgedAt!: Date | null;

  /**
   * When the uploader chose to publish this clip beyond their own team.
   * NULL — the default and the overwhelming majority — means team-only.
   *
   * **A column rather than a table, and that is ADR-0019 Decision 5's
   * requirement rather than a shortcut:** "public-visibility state has no
   * independent lifecycle of its own". A row with its own statuses would
   * have one, and would then need reconciling with `status` every time a
   * clip is hidden, reported, erased or swept.
   *
   * **It is not sufficient on its own.** A clip is publicly visible only
   * while the uploader's parent *also* has an active public-sharing
   * consent (ADR-0030), which the feed query enforces with a join rather
   * than by copying consent state onto the clip. That is deliberate:
   * revoking consent then removes every clip from the feed in the same
   * instant, with nothing to sweep and nothing that can be forgotten —
   * ADR-0030 Decision 2's "disabling un-publishes everything currently
   * public", made structural instead of procedural.
   *
   * ADR-0019's own Decision 8 sketched this as a join to
   * `clip_publication_request`, the per-clip *parental* approval that
   * ADR-0030's amended Decision 3 replaced with the standing switch.
   * That table is therefore never built; the child's own choice of which
   * clips to publish is this column.
   */
  @Column({
    name: 'published_publicly_at',
    type: 'timestamptz',
    nullable: true,
  })
  publishedPubliclyAt!: Date | null;

  /**
   * Whether a person has watched this before strangers can.
   *
   * `published_publicly_at` says the CHILD asked; this says an operator
   * agreed. The feed requires both, and keeping them separate is
   * deliberate — un-publish, consent revocation and the retention sweep
   * all key on the timestamp and must keep working untouched.
   *
   * Same four-column shape as `trainer_post`'s review, so the queue and
   * the operator's habits are one thing rather than two that drift.
   */
  @Column({
    name: 'public_review_status',
    type: 'enum',
    enum: PublicClipReviewStatus,
    enumName: 'public_clip_review_status_enum',
    nullable: true,
  })
  publicReviewStatus!: PublicClipReviewStatus | null;

  @Column({ name: 'public_reviewed_at', type: 'timestamptz', nullable: true })
  publicReviewedAt!: Date | null;

  /** SET NULL: a reviewer leaving must not erase that a review happened. */
  @Column({
    name: 'public_reviewed_by_staff_account_id',
    type: 'uuid',
    nullable: true,
  })
  publicReviewedByStaffAccountId!: string | null;

  /** Shown to the uploader so a refusal is actionable, never to viewers. */
  @Column({
    name: 'public_review_rejection_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  publicReviewRejectionReason!: string | null;
}
