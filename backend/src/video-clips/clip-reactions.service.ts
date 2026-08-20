import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ClipReaction,
  ClipReactionType,
} from './entities/clip-reaction.entity';
import { PublicFeedService } from './public-feed.service';

/** What a viewer gets back, and all they ever get: their own state. */
export interface ViewerReactionResult {
  clipId: string;
  /** null once cleared — the same shape whether set, changed or removed. */
  reaction: ClipReactionType | null;
}

/** The uploader's view of their own clip, in their Archive. */
export type ReactionTotals = Record<ClipReactionType, number>;

const EMPTY_TOTALS: ReactionTotals = {
  [ClipReactionType.NICE]: 0,
  [ClipReactionType.STRONG]: 0,
  [ClipReactionType.CREATIVE]: 0,
  [ClipReactionType.WELL_DONE]: 0,
};

/**
 * Reactions on public clips — ADR-0019 Decision 4, shaped by
 * docs/design/phase6-public-feed-flows.md §5.
 *
 * **The asymmetry here is the product decision, not an oversight.** A
 * viewer on the feed only ever learns their *own* reaction state; the
 * uploader sees totals, but only in their own Archive. There is no
 * endpoint on this service that returns another child's totals to a
 * stranger, and that is deliberate:
 *
 * - The stated goal was publishing a clip "to get reactions", which is
 *   satisfied by the uploader seeing them. It does not require the count
 *   being public.
 * - A visible count on a child's face and voice, rankable against other
 *   children's, is a popularity metric. ADR-0016 already refused that
 *   shape for leaderboard counts on fairness grounds that apply with
 *   more force to video of a child than to a points total.
 * - This app exists to pull children away from TikTok/Snapchat/Instagram.
 *   Importing their central engagement mechanic would be adopting the
 *   thing it was built as an alternative to.
 *
 * If public counts are ever wanted, that is a field on the feed
 * serialization and a decision that overrides the above — not a bug fix.
 */
@Injectable()
export class ClipReactionsService {
  constructor(
    @InjectRepository(ClipReaction)
    private readonly reactions: Repository<ClipReaction>,
    private readonly feed: PublicFeedService,
  ) {}

  /**
   * Set, change, or toggle off one viewer's reaction to one public clip.
   *
   * Tapping a different reaction replaces the existing one; tapping the
   * same one again clears it. Both are the same request from the client's
   * point of view, which is why there is no separate "change" call — the
   * client sends what the child tapped and this decides what that means.
   *
   * **Visibility is re-checked on every write**, through the feed's own
   * gate rather than a copy of it. A clip whose family revoked consent a
   * second ago is not reactable, for the same reason and by the same
   * clauses that make it invisible.
   */
  async react(
    viewerId: string,
    clipId: string,
    reactionType: ClipReactionType,
  ): Promise<ViewerReactionResult> {
    await this.feed.assertPubliclyVisibleTo(viewerId, clipId);

    const existing = await this.reactions.findOne({
      where: { clipId, playerId: viewerId },
      select: { id: true, reactionType: true },
    });

    if (existing?.reactionType === reactionType) {
      // Same reaction tapped twice — clear it. Delete rather than store a
      // "none" value: absence is already the representation of no
      // reaction everywhere else here, and a nullable enum would give the
      // same state two encodings.
      await this.reactions.delete({ id: existing.id });
      return { clipId, reaction: null };
    }

    if (existing) {
      await this.reactions.update({ id: existing.id }, { reactionType });
      return { clipId, reaction: reactionType };
    }

    // The UNIQUE (clip_id, player_id) index is what makes this safe under
    // a double-tap: two concurrent inserts cannot both win, and the
    // loser's conflict is ignored rather than surfaced as an error the
    // child would see for having tapped twice.
    await this.reactions
      .createQueryBuilder()
      .insert()
      .into(ClipReaction)
      .values({ clipId, playerId: viewerId, reactionType })
      .orIgnore()
      .execute();
    return { clipId, reaction: reactionType };
  }

  /**
   * Explicitly clear, for a client that would rather say so than re-send
   * the same reaction. Idempotent: clearing nothing is not an error.
   *
   * Deliberately does NOT re-check public visibility. A viewer must
   * always be able to withdraw their own reaction, including from a clip
   * that has since been unpublished or whose family revoked consent —
   * refusing there would strand a row the viewer wanted gone, which is
   * the opposite of what any of those states mean.
   */
  async clear(viewerId: string, clipId: string): Promise<ViewerReactionResult> {
    await this.reactions.delete({ clipId, playerId: viewerId });
    return { clipId, reaction: null };
  }

  /**
   * The viewer's own reactions across a page of feed items, as a map.
   *
   * One query for the whole page rather than one per card — a feed of 20
   * cards each triggering its own lookup is the classic N+1, and this one
   * would run on every scroll.
   */
  async viewerReactionsFor(
    viewerId: string,
    clipIds: string[],
  ): Promise<Map<string, ClipReactionType>> {
    if (clipIds.length === 0) return new Map();
    const rows = await this.reactions.find({
      where: { playerId: viewerId, clipId: In(clipIds) },
      select: { clipId: true, reactionType: true },
    });
    return new Map(rows.map((r) => [r.clipId, r.reactionType]));
  }

  /**
   * Totals for one clip — **the uploader's own clip only**.
   *
   * The ownership check is here rather than at the controller because it
   * is the whole reason this method is safe to expose at all. Without it
   * this is the public-count endpoint the design argues against, reachable
   * by anyone who knows a clip id.
   */
  async totalsForOwnClip(
    requesterId: string,
    clipId: string,
  ): Promise<ReactionTotals> {
    // Throws NotYourClipException / ClipNotFoundException itself — the
    // same check `publish`/`unpublish` go through.
    await this.feed.ownClipOrThrow(requesterId, clipId);

    const rows = await this.reactions
      .createQueryBuilder('r')
      .select('r.reaction_type', 'reactionType')
      .addSelect('COUNT(*)', 'count')
      .where('r.clip_id = :clipId', { clipId })
      .groupBy('r.reaction_type')
      .getRawMany<{ reactionType: ClipReactionType; count: string }>();

    const totals: ReactionTotals = { ...EMPTY_TOTALS };
    for (const row of rows) {
      totals[row.reactionType] = Number(row.count);
    }
    return totals;
  }
}
