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
 * The four reactions a viewer can leave on a public clip.
 *
 * **Named by meaning, not by glyph.** The design (docs/design/
 * phase6-public-feed-flows.md §5) draws these as 🔥 💪 🎯 👏, but the
 * emoji is presentation: a future pass that swaps 💪 for a different
 * glyph should not need a migration, and a stored `muscle` would be a
 * lie the moment it did.
 *
 * **Four, and all unambiguously positive, is the safety property** —
 * ADR-0019 Decision 4. A closed vocabulary means there is no sentence a
 * reaction can form, so the bullying surface is removed by construction
 * rather than filtered. That is why this is an enum and why nothing here
 * accepts freeform text: the ADR is explicit that reusing ADR-0007's
 * keyword filter for stranger-facing freeform content would be applying
 * that filter past the point its own reviewer said it stops being
 * acceptable.
 *
 * Adding a value is therefore not a routine change. A reaction that can
 * be read as mockery or as a skill judgement re-opens exactly what the
 * closed set closes.
 */
export enum ClipReactionType {
  /** 🔥 "Snyggt!" — general approval, the lowest-effort tap. */
  NICE = 'nice',
  /** 💪 "Starkt!" — effort rather than outcome, the app's own ethos. */
  STRONG = 'strong',
  /** 🎯 "Kreativt!" — mirrors the "Most creative drill" badge. */
  CREATIVE = 'creative',
  /** 👏 "Bra jobbat!" — encouragement carrying no skill claim. */
  WELL_DONE = 'well_done',
}

/**
 * One viewer's reaction to one public clip — ADR-0019 Decision 4.
 *
 * **Both foreign keys cascade on delete, and both for stated reasons.**
 * `clip_id` because a reaction is pure derived engagement data, worthless
 * without the clip it describes (the same reasoning ADR-0018 Decision 4
 * gives for `VideoClipTag`); `player_id` because reacting is a personal
 * action carrying no accountability weight — the same category as
 * `TeamChatBlock`, deliberately NOT the category as `ClipReport`, which
 * is an accusation and must survive its reporter.
 *
 * The practical payoff of the cascade is that every existing deletion
 * path that removes a `VideoClip` or a `Player` — the 90-day retention
 * sweep, uploader self-delete, and ADR-0013's account-erasure walk —
 * takes these rows with it automatically, with no new code to write or
 * remember.
 *
 * **`UNIQUE (clip_id, player_id)` is the whole concurrency story.**
 * Changing your reaction updates the row rather than adding a second
 * one: idempotent preference-toggle semantics, the same distinction
 * ADR-0007 Decision 4 already draws between a block (a toggle) and a
 * report (an accusation, which must not be inflatable). A viewer cannot
 * inflate a count by tapping faster.
 */
@Entity('clip_reaction')
@Index('UQ_clip_reaction_clip_player', ['clipId', 'playerId'], {
  unique: true,
})
export class ClipReaction {
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

  @Column({
    name: 'reaction_type',
    type: 'enum',
    enum: ClipReactionType,
    enumName: 'clip_reaction_type_enum',
  })
  reactionType!: ClipReactionType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
