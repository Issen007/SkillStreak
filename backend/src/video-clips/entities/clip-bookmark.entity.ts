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
import { VideoClip } from './video-clip.entity';

/**
 * A clip a viewer saved from Utforska — ADR-0019 Decision 6's Sparade.
 *
 * **The one new entity Phase 6 adds.** The other two archive collections
 * (Laget, Mina) are views over the team feed and deliberately store
 * nothing; this one has to exist because "a stranger's clip I liked" is
 * not derivable from anything else.
 *
 * **A bookmark is a pointer, never a copy.** Decision 6 requires the
 * archive to re-check publication status at fetch time and never trust
 * the stored row: the clip may since have been un-published by its
 * uploader, lost its family's consent, been reported off the feed, or
 * been swept by retention. A bookmark that rendered from stored data
 * would be a private copy of another child's video that survived their
 * decision to withdraw it — which is exactly what the consent model
 * exists to make impossible.
 *
 * Both foreign keys cascade for the same reasons `ClipReaction`'s do: it
 * is derived personal data with no accountability weight, worthless
 * without its clip, and every existing deletion path should take it
 * along without new code.
 */
@Entity('clip_bookmark')
@Index('UQ_clip_bookmark_clip_player', ['clipId', 'playerId'], { unique: true })
export class ClipBookmark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'clip_id', type: 'uuid' })
  clipId!: string;

  @ManyToOne(() => VideoClip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clip_id' })
  clip!: VideoClip;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
