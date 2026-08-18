import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';

/** One card in the public feed. Deliberately small — see the class doc. */
export interface PublicFeedItem {
  clipId: string;
  durationSeconds: number;
  screenName: string;
  avatarId: string | null;
  publishedAt: Date;
}

export interface PublicFeedPage {
  items: PublicFeedItem[];
  /** Opaque keyset cursor for the next page, or null at the end. */
  nextCursor: string | null;
}

export const PUBLIC_FEED_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * ADR-0019's public clip feed, as amended by ADR-0030.
 *
 * **Nothing calls this yet.** There is no controller and no screen; this
 * is the query shape, built ahead of the feature so the remaining
 * blocker — ADR-0030 finding 4, the reminder that cannot detect a bounce
 * — is the only thing left when the mail provider question resolves.
 *
 * Four gates, all in one statement, and the ordering of the reasoning
 * matters more than the SQL:
 *
 * 1. **The child chose to publish it** — `published_publicly_at IS NOT
 *    NULL`. Under ADR-0030's amended Decision 3 there is no per-clip
 *    parental approval; the parent's consent is account-level and the
 *    child picks which of their own clips go out.
 * 2. **The parent's consent is active right now** — an INNER JOIN on
 *    `public_sharing_consent`, not a copied flag. This is the important
 *    one: revoking consent empties that child's clips from the feed in
 *    the same instant, with nothing to sweep and nothing anyone has to
 *    remember. ADR-0030 Decision 2 requires that un-publish be
 *    "immediate and unconditional"; a join makes it structural rather
 *    than procedural.
 * 3. **The clip is still published** — a team-reported (`hidden`) clip
 *    must not stay visible to strangers after disappearing for the
 *    fifteen people who know the child in person. ADR-0019 Decision 5's
 *    amendment, and the database carries the same rule as a CHECK.
 * 4. **The viewer has not blocked the uploader** — the identical
 *    `NOT EXISTS` clause `listClips` already applies, so a block means
 *    the same thing in both feeds.
 *
 * **What the row deliberately does not contain**, per ADR-0019
 * Decision 3: no team name, and `taggedPlayerId` is never resolved. A
 * viewer sees a clip and a screen name. Naming a stranger's team is how
 * an online contact becomes a physical one, and this app has no location
 * data precisely so that cannot happen.
 *
 * Keyset pagination rather than OFFSET, per Decision 8 — a feed people
 * scroll while new items arrive at the head is exactly where OFFSET
 * silently skips and repeats rows.
 */
@Injectable()
export class PublicFeedService {
  constructor(
    @InjectRepository(VideoClip)
    private readonly clips: Repository<VideoClip>,
  ) {}

  async list(
    viewerId: string,
    cursor?: string,
    limit: number = PUBLIC_FEED_PAGE_SIZE,
  ): Promise<PublicFeedPage> {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const decoded = decodeCursor(cursor);

    const qb = this.clips
      .createQueryBuilder('clip')
      .innerJoin('player', 'player', 'player.id = clip.uploader_player_id')
      // Gate 2. INNER JOIN, so a revoked or never-granted consent removes
      // the row rather than merely flagging it.
      .innerJoin(
        'public_sharing_consent',
        'psc',
        "psc.player_id = clip.uploader_player_id AND psc.status = 'active'",
      )
      .select([
        'clip.id AS "clipId"',
        'clip.duration_seconds AS "durationSeconds"',
        'clip.published_publicly_at AS "publishedAt"',
        'player.screen_name AS "screenName"',
        'player.avatar_id AS "avatarId"',
      ])
      .where('clip.published_publicly_at IS NOT NULL')
      .andWhere('clip.status = :published', {
        published: VideoClipStatus.PUBLISHED,
      })
      // Gate 4 — the same clause listClips applies, so a block means one
      // thing across the app rather than two.
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM team_chat_block b
           WHERE b.blocker_player_id = :viewerId
             AND b.blocked_player_id = clip.uploader_player_id)`,
        { viewerId },
      );

    if (decoded) {
      // Strict keyset comparison on the exact ORDER BY tuple. Comparing
      // the timestamp alone would drop every clip sharing a millisecond
      // with the last row of the previous page.
      qb.andWhere(
        '(clip.published_publicly_at, clip.id) < (:cursorAt, :cursorId)',
        { cursorAt: decoded.publishedAt, cursorId: decoded.clipId },
      );
    }

    const rows = await qb
      .orderBy('clip.published_publicly_at', 'DESC')
      .addOrderBy('clip.id', 'DESC')
      // One extra row, purely to answer "is there a next page" without a
      // second COUNT query over the same predicates.
      .limit(take + 1)
      .getRawMany<PublicFeedItem>();

    const items = rows.slice(0, take).map((r) => ({
      ...r,
      publishedAt: new Date(r.publishedAt),
    }));
    const last = items[items.length - 1];

    return {
      items,
      nextCursor:
        rows.length > take && last
          ? encodeCursor(last.publishedAt, last.clipId)
          : null,
    };
  }
}

/**
 * The cursor is opaque to clients but carries no secret — it is a
 * timestamp and a clip id the viewer has just been shown. Base64 rather
 * than signed, because forging one can only reposition a viewer inside a
 * feed every gate above still applies to.
 */
function encodeCursor(publishedAt: Date, clipId: string): string {
  return Buffer.from(`${publishedAt.toISOString()}|${clipId}`).toString(
    'base64url',
  );
}

function decodeCursor(
  cursor?: string,
): { publishedAt: Date; clipId: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const publishedAt = new Date(at);
    // A malformed cursor returns the first page rather than throwing: it
    // is client state, and a 500 on a stale bookmark helps nobody.
    if (!id || Number.isNaN(publishedAt.getTime())) return null;
    return { publishedAt, clipId: id };
  } catch {
    return null;
  }
}
