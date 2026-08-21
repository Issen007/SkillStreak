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

/**
 * ADR-0031 Decision 1 — a short-lived, single-use ticket that says "the
 * holder of this may attach *their own* trainer account to this player".
 *
 * **The player identity comes from here and never from a request field.**
 * That is the point of the whole mechanism: neither side of the link is
 * allowed to name the other. A challenge is minted only by a player's own
 * authenticated session, so a trainer cannot start a link against a child
 * they identify by name, email or code — the attack that would otherwise
 * make this feature a way for an adult to reach a child's account.
 *
 * Stored as a SHA-256 hash, never the token itself. A leaked database
 * dump then yields nothing usable, the same posture the consent tokens
 * take; the plaintext exists only in the response to the player who asked
 * and in the URL they hand to the console.
 *
 * It carries no authority of its own. Possessing one lets you attach your
 * own staff account to that player and nothing else — and because
 * Decision 3 makes the resulting link grant nothing, even a stolen
 * challenge is worth very little. The remedy is the player's own unlink,
 * which needs no cooperation from anyone.
 */
@Entity('account_link_challenge')
export class AccountLinkChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** SHA-256 of the token. Looked up by hash; the plaintext is never stored. */
  @Index('IDX_account_link_challenge_token')
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /**
   * Set the moment it is redeemed. Single-use is enforced by a
   * conditional UPDATE on this being NULL rather than by reading it
   * first — two console tabs racing the same challenge must not both
   * succeed, and a check-then-write would let them.
   */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
