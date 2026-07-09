import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ChatMessageReportReason {
  BULLYING = 'bullying',
  INAPPROPRIATE_LANGUAGE = 'inappropriate_language',
  SPAM = 'spam',
  OTHER = 'other',
}

// docs/adr/0007-team-chat.md Decision 1/3 — an append-only audit trail,
// same rationale ADR-0002 gives ParentalConsentRecord: this is the one
// place in the feature with real accountability weight, so it's a
// separate, never-mutated table. `note` is capped the same way
// BadgeAwardContext's human-authored `note` is. **No response anywhere
// returns rows from this table to any player** — not to the reported
// player, not to the team, not even a count; only a per-viewer
// `reportedByMe: boolean` on the message-list response is ever derived from
// it (protects the reporter's anonymity — a real retaliation-prevention
// concern with no adult mediating this peer group).
@Entity('team_chat_message_report')
@Index(
  'UQ_team_chat_message_report_message_reporter',
  ['messageId', 'reporterPlayerId'],
  { unique: true },
)
export class TeamChatMessageReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @Column({ name: 'reporter_player_id', type: 'uuid' })
  reporterPlayerId!: string;

  @Column({
    type: 'enum',
    enum: ChatMessageReportReason,
    enumName: 'team_chat_message_report_reason_enum',
  })
  reason!: ChatMessageReportReason;

  @Column({ type: 'varchar', length: 140, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
