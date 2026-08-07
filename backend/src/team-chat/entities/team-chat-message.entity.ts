import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ChatMessageStatus {
  VISIBLE = 'visible',
  HIDDEN = 'hidden',
}

// docs/adr/0021-clip-challenge-notifications.md Decision 2 — a real
// discriminator, not an overload of the existing nullable `senderPlayerId`.
// 'system' unambiguously means "never had a real sender, from creation";
// 'player' + senderPlayerId IS NULL still unambiguously means what
// docs/adr/0013-account-erasure.md Decision 6 already established ("a real
// player, since erased"). Never client-settable: no DTO on
// POST .../chat/messages exposes either this or systemEventType below —
// the only writer of a 'system' row is VideoClipsService.completeUpload's
// direct repository insert (never TeamChatService.postMessage's HTTP path).
export enum ChatMessageAuthorType {
  PLAYER = 'player',
  SYSTEM = 'system',
}

// docs/adr/0021-clip-challenge-notifications.md Decision 2 — a
// discriminated-union extension point in the same spirit as
// BadgeAward.context's triggerReason (ADR-0002 addendum) — room for a
// future second system-event kind without a new column. NULL for every
// author_type = 'player' row.
export enum SystemChatEventType {
  CLIP_CHALLENGE_ISSUED = 'clip_challenge_issued',
}

// docs/adr/0007-team-chat.md Decision 1 — durable, audit-relevant history,
// same posture ADR-0002 gives TrainingLogEntry, not a cache. Team-scoped by
// construction (team_id denormalized here, same reasoning as
// TrainingLogEntry.team_id: every read is team-scoped, so scoping never
// requires a join out to Player). No updated_at/edit history: messages are
// send-once, never mutated/redacted (Decision 2) — a rejected send is never
// stored at all, and a message that's later hidden only ever flips `status`
// (an out-of-band admin action, Decision 3 — never set by any in-app
// endpoint).
@Entity('team_chat_message')
@Index('IDX_team_chat_message_team_created_at', ['teamId', 'createdAt'])
export class TeamChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  // ON DELETE SET NULL at the DB level (see the AddAccountErasure
  // migration) — docs/adr/0013-account-erasure.md Decision 6: an erased
  // player's messages are anonymized in place (this column set null,
  // `content` overwritten with a fixed placeholder), never hard-deleted,
  // to preserve the remaining team's flat chat feed continuity. That
  // UPDATE lives only inside AccountErasureService's own execution
  // transaction — see that service's comment.
  @Column({ name: 'sender_player_id', type: 'uuid', nullable: true })
  senderPlayerId!: string | null;

  @Column({ type: 'varchar', length: 500 })
  content!: string;

  // docs/adr/0017-chat-clip-attachments.md Decision 4 — a plain, single-
  // column, nullable FK to video_clip.id, ON DELETE SET NULL at the DB
  // level (see the AddChatClipAttachments migration). Deliberately NOT part
  // of a composite FK with team_id (Decision 1 explains why that would be
  // wrong — a clip's own hard-delete would then null this message's own
  // team_id too). Team-scoping of this reference is enforced entirely in
  // application code: TeamChatService.postMessage asserts
  // clip.teamId === teamId at write time, and the read-time query's join
  // predicate re-asserts it (plus clip.status === 'published') on every
  // read — never trust this column alone. No other clip data (caption,
  // uploader, thumbnail) is ever stored on this row (Decision 2) — every
  // read resolves the embed live from the current VideoClip row.
  @Column({ name: 'clip_id', type: 'uuid', nullable: true })
  clipId!: string | null;

  @Column({
    type: 'enum',
    enum: ChatMessageStatus,
    enumName: 'team_chat_message_status_enum',
    default: ChatMessageStatus.VISIBLE,
  })
  status!: ChatMessageStatus;

  // docs/adr/0021-clip-challenge-notifications.md Decision 2 — see
  // ChatMessageAuthorType's own comment above. Defaults every existing row
  // to 'player' (backfill-safe, matches every row's actual history).
  @Column({
    name: 'author_type',
    type: 'enum',
    enum: ChatMessageAuthorType,
    enumName: 'team_chat_message_author_type_enum',
    default: ChatMessageAuthorType.PLAYER,
  })
  authorType!: ChatMessageAuthorType;

  // docs/adr/0021-clip-challenge-notifications.md Decision 2 — see
  // SystemChatEventType's own comment above. NULL for author_type='player'.
  @Column({
    name: 'system_event_type',
    type: 'enum',
    enum: SystemChatEventType,
    enumName: 'team_chat_message_system_event_type_enum',
    nullable: true,
  })
  systemEventType!: SystemChatEventType | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
