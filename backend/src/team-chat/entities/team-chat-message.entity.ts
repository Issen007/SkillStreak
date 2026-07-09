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

  // ON DELETE RESTRICT at the DB level (see the migration) — same
  // precedent as Challenge.created_by_player_id: don't silently orphan a
  // message by deleting a player who doesn't exist as a deletable entity
  // yet anyway.
  @Column({ name: 'sender_player_id', type: 'uuid' })
  senderPlayerId!: string;

  @Column({ type: 'varchar', length: 500 })
  content!: string;

  @Column({
    type: 'enum',
    enum: ChatMessageStatus,
    enumName: 'team_chat_message_status_enum',
    default: ChatMessageStatus.VISIBLE,
  })
  status!: ChatMessageStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
