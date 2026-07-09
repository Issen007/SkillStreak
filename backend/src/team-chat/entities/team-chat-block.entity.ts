import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// docs/adr/0007-team-chat.md Decision 4 — a per-viewer mute, never
// team-wide: blocker_player_id mutes blocked_player_id's messages in the
// blocker's own view only (enforced in TeamChatService's message-list
// query, a NOT EXISTS against this table scoped to the viewer). Blocking is
// silent (the blocked player is never notified, no response anywhere
// reveals who has blocked them) and idempotent (blocking an already-blocked
// player is a 200 no-op) — the unique index below is what makes a repeat
// block cheap to detect rather than accumulating duplicate rows.
@Entity('team_chat_block')
@Index(
  'UQ_team_chat_block_blocker_blocked',
  ['blockerPlayerId', 'blockedPlayerId'],
  { unique: true },
)
export class TeamChatBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'blocker_player_id', type: 'uuid' })
  blockerPlayerId!: string;

  @Column({ name: 'blocked_player_id', type: 'uuid' })
  blockedPlayerId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
