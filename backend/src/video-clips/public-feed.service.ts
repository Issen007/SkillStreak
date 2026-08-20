import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ClipNotFoundException,
  NotYourClipException,
  PublicSharingNotConsentedException,
} from '../common/errors/exceptions';
import { Player } from '../players/entities/player.entity';
import { PublicSharingAccessService } from '../public-sharing/public-sharing-access.service';
import { PublicSharingConsentService } from '../public-sharing/public-sharing-consent.service';
import { ClipReactionType } from './entities/clip-reaction.entity';
import { ObjectStorageService } from './object-storage.service';
import { CLIP_PLAYBACK_URL_EXPIRES_SECONDS } from './video-clip.constants';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';

/** One card in the public feed. Deliberately small — see the class doc. */
export interface PublicFeedItem {
  clipId: string;
  durationSeconds: number;
  screenName: string;
  avatarId: string | null;
  /** The uploader's own words. Still the only free text on this surface —
   * it was written for a team audience and is moderated on upload by the
   * same filter the team feed uses; publishing does not re-open it. */
  caption: string | null;
  /**
   * Short-lived presigned GET, minted per request exactly as the team
   * feed does. Never a durable URL: ADR-0019 Decision 2 bounds "public"
   * to authenticated players, so a link that outlived the response would
   * quietly widen that to anyone it was pasted to.
   */
  playbackUrl: string;
  publishedAt: Date;
  /**
   * The viewer's *own* reaction, or null. Filled in by the controller,
   * which is why it is optional on the service's own return.
   *
   * **There is no total here and that is deliberate** — a viewer on the
   * feed learns their own state and nothing about anyone else's. See
   * ClipReactionsService's class doc for the argument.
   */
  myReaction?: ClipReactionType | null;
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
 * is the query shape, built ahead of the feature.
 *
 * The blocker it was waiting on — ADR-0030 finding 4, the reminder that
 * could not detect a bounce — closed 2026-08-19 (ADR-0030 Decision 12).
 * What still gates the feature is the `PUBLIC_SHARING_ENABLED_TEAM_IDS`
 * allow-list and Decision 9's review, due 2026-09-16.
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
    // Only ever read for the viewer's own `team_id`, to answer the
    // rollout gate. Resolved here rather than passed in by the controller
    // so that no caller can gate on a team the viewer is not in.
    @InjectRepository(Player)
    private readonly players: Repository<Player>,
    private readonly consentService: PublicSharingConsentService,
    private readonly access: PublicSharingAccessService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /**
   * The uploader puts one of their own clips into the public feed.
   *
   * Three checks, and the third is the one CLAUDE.md's amended
   * closed-bubble rule turns on: the clip must be the requester's own
   * (never another child's), it must still be published to its team, and
   * the requester's parent must have an **active** public-sharing
   * consent at this moment.
   *
   * The consent is re-read here rather than trusted from any earlier
   * step. A parent who revoked yesterday must not have a clip published
   * under their name today because some session cached a `true`.
   */
  async publish(
    requesterId: string,
    clipId: string,
  ): Promise<{ clipId: string; publishedPublicly: true }> {
    const clip = await this.ownClipOrThrow(requesterId, clipId);

    // The rollout gate, checked before consent. A team outside the
    // allow-list cannot publish even with a live parental consent —
    // widening the feature is a deployment decision, not something a
    // family can opt into ahead of it.
    if (!this.access.isEnabledForTeam(clip.teamId)) {
      throw new PublicSharingNotConsentedException();
    }

    if (clip.status !== VideoClipStatus.PUBLISHED) {
      // A hidden or still-uploading clip cannot become publicly visible;
      // the database CHECK refuses the state too.
      throw new ClipNotFoundException();
    }
    if (!(await this.consentService.isActiveFor(requesterId))) {
      throw new PublicSharingNotConsentedException();
    }

    // Idempotent: re-publishing an already-public clip keeps its original
    // timestamp rather than jumping it back to the top of the feed, which
    // would otherwise be a free way to farm the feed's ordering.
    if (!clip.publishedPubliclyAt) {
      await this.clips.update(
        { id: clip.id, uploaderPlayerId: requesterId },
        { publishedPubliclyAt: new Date() },
      );
    }
    return { clipId, publishedPublicly: true };
  }

  /**
   * The uploader takes their clip back out of the public feed.
   *
   * **Deliberately unconditional**, and the asymmetry with `publish` is
   * the point. ADR-0019 Decision 5 requires un-publish to be "immediate
   * and unconditional, exactly matching self-delete's existing
   * guarantee" — so there is no consent check, no report check and no
   * confirmation step here.
   *
   * Requiring an active consent to un-publish would be precisely
   * backwards: the case where a parent has just revoked is the case where
   * getting a clip out fastest matters most, and a child locked out of
   * un-publishing by the same event that should have removed the clip is
   * the worst possible failure of this design.
   *
   * Note the clip is already invisible to the feed the moment consent
   * lapses, because the feed joins consent — this is for the case where
   * the child simply changes their mind.
   */
  async unpublish(
    requesterId: string,
    clipId: string,
  ): Promise<{ clipId: string; publishedPublicly: false }> {
    const clip = await this.ownClipOrThrow(requesterId, clipId);

    if (clip.publishedPubliclyAt) {
      await this.clips.update(
        { id: clip.id, uploaderPlayerId: requesterId },
        { publishedPubliclyAt: null },
      );
    }
    return { clipId, publishedPublicly: false };
  }

  /**
   * Throws unless `clipId` is, right now, publicly visible **to this
   * viewer** — the same four gates `list()` applies, for a single clip.
   *
   * **This exists so reactions cannot drift away from the feed.** A
   * reaction endpoint that re-derived "is this public?" would be a second
   * definition of public visibility, and the two would diverge on exactly
   * the case that matters: a parent revoking consent must stop a
   * stranger reacting to their child's clip in the same instant it stops
   * them seeing it. Both now fail through the same clauses.
   *
   * Returns the uploader's id, because every caller needs it and
   * re-fetching the clip to get it would be a second read of the row this
   * query already touched.
   */
  async assertPubliclyVisibleTo(
    viewerId: string,
    clipId: string,
  ): Promise<{ uploaderPlayerId: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(clipId)) throw new ClipNotFoundException();

    // Gate 1, the rollout allow-list — resolved from the viewer's own
    // row, never from anything the caller supplied.
    const viewer = await this.players.findOne({
      where: { id: viewerId },
      select: { teamId: true },
    });
    if (!this.access.isEnabledForTeam(viewer?.teamId)) {
      throw new ClipNotFoundException();
    }

    const row = await this.clips
      .createQueryBuilder('clip')
      // Gate 2 — INNER JOIN, so a revoked consent removes the row rather
      // than flagging it, exactly as in `list()`.
      .innerJoin(
        'public_sharing_consent',
        'psc',
        "psc.player_id = clip.uploader_player_id AND psc.status = 'active'",
      )
      .select('clip.uploader_player_id', 'uploaderPlayerId')
      .where('clip.id = :clipId', { clipId })
      // Gate 3.
      .andWhere('clip.published_publicly_at IS NOT NULL')
      .andWhere('clip.status = :published', {
        published: VideoClipStatus.PUBLISHED,
      })
      // Gate 4 — a blocked uploader's clip is not visible, so it is not
      // reactable either.
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM team_chat_block b
           WHERE b.blocker_player_id = :viewerId
             AND b.blocked_player_id = clip.uploader_player_id)`,
        { viewerId },
      )
      .getRawOne<{ uploaderPlayerId: string }>();

    // Deliberately ClipNotFoundException for every failure above, not a
    // distinct "not public" error. Telling a stranger the difference
    // between "no such clip" and "that clip exists but its family
    // withdrew consent" is a disclosure about a specific child.
    if (!row) throw new ClipNotFoundException();
    return row;
  }

  /**
   * Ownership, scoped by uploader rather than by team.
   *
   * "The player's own clips, never another child's" is the first thing
   * CLAUDE.md's amended rule promises, so it is enforced in one place
   * every caller goes through rather than repeated at each.
   *
   * **Public rather than private since 2026-08-20**, so
   * `ClipReactionsService.totalsForOwnClip` gates on the same check
   * instead of writing a second one. Reaction totals are uploader-only by
   * design, and a second ownership rule is exactly how that stops being
   * true.
   */
  async ownClipOrThrow(
    requesterId: string,
    clipId: string,
  ): Promise<VideoClip> {
    if (!/^[0-9a-f-]{36}$/i.test(clipId)) throw new ClipNotFoundException();
    const clip = await this.clips.findOne({ where: { id: clipId } });
    if (!clip) throw new ClipNotFoundException();
    if (clip.uploaderPlayerId !== requesterId) throw new NotYourClipException();
    return clip;
  }

  async list(
    viewerId: string,
    cursor?: string,
    limit: number = PUBLIC_FEED_PAGE_SIZE,
  ): Promise<PublicFeedPage> {
    // Reading is gated as well as publishing. A team not in the rollout
    // should not see other teams' children either — the feature is off
    // for them in both directions, which is what "off" has to mean.
    //
    // An empty page rather than a 403: the feed is a screen the app may
    // route to before it knows the answer, and "nothing here yet" is the
    // honest thing to render for a team the rollout has not reached.
    const viewer = await this.players.findOne({
      where: { id: viewerId },
      select: { teamId: true },
    });
    if (!this.access.isEnabledForTeam(viewer?.teamId)) {
      return { items: [], nextCursor: null };
    }
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
        'clip.caption AS "caption"',
        'clip.storage_key AS "storageKey"',
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
      .getRawMany<PublicFeedItem & { storageKey: string }>();

    // Presign after slicing, so the extra look-ahead row never costs a
    // signature. `storageKey` is destructured out here and deliberately
    // never reaches the response: it is the bucket path of a child's
    // video, and the presigned URL is the only form of it a client has
    // any business holding.
    const items: PublicFeedItem[] = await Promise.all(
      rows.slice(0, take).map(async ({ storageKey, ...r }) => ({
        ...r,
        playbackUrl: await this.objectStorage.createPresignedGetUrl(
          storageKey,
          CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
        ),
        publishedAt: new Date(r.publishedAt),
      })),
    );
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
