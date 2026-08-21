import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Player } from '../../players/entities/player.entity';
import { StaffAccount } from '../../staff-auth/entities/staff-account.entity';

/**
 * ADR-0031 — one person's player account and trainer account, joined.
 *
 * **This row grants nothing** (Decision 3), and that is the property the
 * whole design rests on. No guard reads it. Being linked gives the
 * trainer no visibility of the player's training data, team, clips, chat
 * or consents, and gives the player no staff privilege. Every
 * authorisation still resolves from the credential presented on the
 * request: a staff cookie authorises staff routes, a player JWT
 * authorises player routes.
 *
 * Keeping it worthless is what keeps it safe. If it ever granted
 * anything, the short-lived challenge that creates it would become worth
 * stealing and the unilateral unlink would become a way to lock someone
 * out. **Do not add a guard that consults this table** — there is a test
 * that fails if one appears.
 *
 * One-to-one in both directions: a unique index on each column. A
 * one-to-many link would assert "this adult is also these children",
 * which the system cannot verify and has no use for.
 */
@Entity('account_link')
export class AccountLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_account_link_player', { unique: true })
  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @Index('UQ_account_link_staff', { unique: true })
  @Column({ name: 'staff_account_id', type: 'uuid' })
  staffAccountId!: string;

  @ManyToOne(() => StaffAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_account_id' })
  staffAccount!: StaffAccount;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
