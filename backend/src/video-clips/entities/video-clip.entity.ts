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

  // ON DELETE RESTRICT at the DB level (see the migration) — same
  // precedent as TeamChatMessage.sender_player_id: no player-deletion
  // feature exists yet, so don't silently orphan a clip by allowing one.
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
}
