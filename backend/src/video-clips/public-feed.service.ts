import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ClipNotFoundException,
  NotYourClipException,
  PublicSharingNotConsentedException,
} from '../common/errors/exceptions';
import { Player } from '../players/entities/player.entity';
import { PublicSharingAccessService } from '../public-sharing/public-sharing-access.service';
import { PublicSharingConsentService } from '../public-sharing/public-sharing-consent.service';
import { ClipBookmark } from './entities/clip-bookmark.entity';
import { ClipReactionType } from './entities/clip-reaction.entity';
import { ClipReport, ClipReportReason } from './entities/clip-report.entity';
import { ObjectStorageService } from './object-storage.service';
import { CLIP_PLAYBACK_URL_EXPIRES_SECONDS } from './video-clip.constants';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';

/** One card in the public feed. Deliberately small — see the class doc. */
export interface PublicFeedItem {
  clipId: string;
  durationSeconds: number;
  screenName: string;
  avatarId: string | null;
  /*
   * `caption` is deliberately absent. It used to be here, described as
   * "the only free text on this surface" and justified by the moderation
   * the team feed already applies — but that filter is a safety wordlist,
   * not a check for names and places, and the caption was written for
   * teammates before publishing outside the team was possible.
   *
   * Both consent surfaces promise a stranger never sees a real name, a
   * team or where the child trains. A caption can contain all three
   * ("bra jobbat Anna!", "hemma hos mig"), which made the promise
   * something the app could not keep. Owner's decision, 2026-08-22: the
   * caption stays inside the team, and the promise goes back to being
   * true as written.
   *
   * It is not deleted — `clip.caption` is untouched and still shown to the
   * child's own team. It simply does not leave the bubble.
   */
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
  /** Whether the viewer has this in Sparade. Filled by the controller,
   * same reason as `myReaction`. */
  savedByMe?: boolean;
}

export interface PublicFeedPage {
  items: PublicFeedItem[];
  /** Opaque keyset cursor for the next page, or null at the end. */
  nextCursor: string | null;
}

export const PUBLIC_FEED_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
/** A shelf, not a feed — bounded so one query answers it. */
const MAX_SAVED = 200;

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
    @InjectRepository(ClipReport)
    private readonly reports: Repository<ClipReport>,
    @InjectRepository(ClipBookmark)
    private readonly bookmarks: Repository<ClipBookmark>,
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
   * Which of these clips the viewer has saved — one query for a page,
   * not one per card.
   */
  async savedClipIdsFor(
    viewerId: string,
    clipIds: string[],
  ): Promise<Set<string>> {
    if (clipIds.length === 0) return new Set();
    const rows = await this.bookmarks.find({
      where: { playerId: viewerId, clipId: In(clipIds) },
      select: { clipId: true },
    });
    return new Set(rows.map((r) => r.clipId));
  }

  /** Save a clip from Utforska. Requires it to be visible right now —
   * you cannot bookmark something you are not allowed to see. */
  async saveBookmark(
    viewerId: string,
    clipId: string,
  ): Promise<{ clipId: string; saved: true }> {
    await this.assertPubliclyVisibleTo(viewerId, clipId);
    await this.bookmarks
      .createQueryBuilder()
      .insert()
      .into(ClipBookmark)
      .values({ clipId, playerId: viewerId })
      .orIgnore()
      .execute();
    return { clipId, saved: true };
  }

  /**
   * Un-save. Deliberately does NOT check visibility, for the same reason
   * withdrawing a reaction does not: a viewer must always be able to
   * remove their own row, including one pointing at a clip that has since
   * gone.
   */
  async removeBookmark(
    viewerId: string,
    clipId: string,
  ): Promise<{ clipId: string; saved: false }> {
    await this.bookmarks.delete({ clipId, playerId: viewerId });
    return { clipId, saved: false };
  }

  /**
   * Screen A1's Sparade — **re-validated on every open, never rendered
   * from the stored row** (ADR-0019 Decision 6).
   *
   * The bookmark is a pointer. Between saving and opening, the clip may
   * have been un-published by its uploader, lost its family's consent,
   * been reported off the feed, or been swept by retention. Rendering
   * from stored data would give a child a private copy of another child's
   * video that outlived their decision to withdraw it — precisely what
   * the consent model exists to prevent. So this runs the same four gates
   * the feed does and drops whatever no longer passes.
   *
   * `missingCount` exists so the UI can say something happened without
   * saying *what*. The design's row is non-attributable on purpose:
   * naming which clip vanished would let a viewer track another child's
   * un-publish decisions, turning a bookmark into a surveillance tool.
   */
  async listSaved(
    viewerId: string,
  ): Promise<{ items: PublicFeedItem[]; missingCount: number }> {
    const saved = await this.bookmarks.find({
      where: { playerId: viewerId },
      select: { clipId: true },
      order: { createdAt: 'DESC' },
      take: MAX_SAVED,
    });
    if (saved.length === 0) return { items: [], missingCount: 0 };

    const viewer = await this.players.findOne({
      where: { id: viewerId },
      select: { teamId: true },
    });
    if (!this.access.isEnabledForTeam(viewer?.teamId)) {
      // Outside the allow-list the whole surface is gone, so every saved
      // row is "missing" in the only sense the UI cares about.
      return { items: [], missingCount: saved.length };
    }

    const ids = saved.map((b) => b.clipId);
    const rows = await this.clips
      .createQueryBuilder('clip')
      .innerJoin('player', 'player', 'player.id = clip.uploader_player_id')
      .innerJoin(
        'public_sharing_consent',
        'psc',
        "psc.player_id = clip.uploader_player_id AND psc.status = 'active'",
      )
      .select([
        'clip.id AS "clipId"',
        'clip.duration_seconds AS "durationSeconds"',
        'clip.published_publicly_at AS "publishedAt"',
        'clip.storage_key AS "storageKey"',
        'player.screen_name AS "screenName"',
        'player.avatar_id AS "avatarId"',
      ])
      .where('clip.id IN (:...ids)', { ids })
      .andWhere('clip.published_publicly_at IS NOT NULL')
      .andWhere('clip.status = :published', {
        published: VideoClipStatus.PUBLISHED,
      })
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM team_chat_block b
           WHERE b.blocker_player_id = :viewerId
             AND b.blocked_player_id = clip.uploader_player_id)`,
        { viewerId },
      )
      .getRawMany<PublicFeedItem & { storageKey: string }>();

    const byId = new Map(rows.map((r) => [r.clipId, r]));
    // Ordered by when the viewer saved them, not by when they were
    // published — this is their shelf, not a feed.
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((r): r is PublicFeedItem & { storageKey: string } => Boolean(r));

    const items: PublicFeedItem[] = await Promise.all(
      ordered.map(async ({ storageKey, ...r }) => ({
        ...r,
        playbackUrl: await this.objectStorage.createPresignedGetUrl(
          storageKey,
          CLIP_PLAYBACK_URL_EXPIRES_SECONDS,
        ),
        publishedAt: new Date(r.publishedAt),
      })),
    );

    return { items, missingCount: saved.length - items.length };
  }

  /**
   * Screen F3 — a viewer reports a stranger's public clip.
   *
   * **Auto-revokes public visibility only** (ADR-0019 Decision 4). The
   * clip goes back to being a team clip; it is not hidden from its own
   * team and it is not deleted. That asymmetry is deliberate: a stranger
   * on the public feed has standing to say "this should not be out here",
   * and none at all to reach inside another team's bubble and remove
   * something from the people who already had it.
   *
   * The reporter is told nothing afterwards. What happens to the clip is
   * another family's business, and reporting back on it would make the
   * report a channel for learning about them.
   */
  async reportPublicClip(
    viewerId: string,
    clipId: string,
    reason: ClipReportReason,
  ): Promise<{ clipId: string; reported: true }> {
    const { uploaderPlayerId } = await this.assertPubliclyVisibleTo(
      viewerId,
      clipId,
    );

    // Same one-report-per-viewer-per-clip rule the team feed enforces —
    // a report is an accusation and must not be inflatable. A repeat is
    // silently accepted rather than rejected: telling a child "you
    // already reported this" is a fact about their own past action, but
    // erroring on it makes the safest button in the app feel broken.
    await this.reports
      .createQueryBuilder()
      .insert()
      .into(ClipReport)
      .values({
        clipId,
        reporterPlayerId: viewerId,
        reportedUploaderPlayerId: uploaderPlayerId,
        reason,
      })
      .orIgnore()
      .execute();

    // Conditional on the clip still being public, so two reporters
    // racing cannot both "un-publish" and have the second silently
    // resurrect anything. Nothing else about the clip is touched.
    await this.clips.update({ id: clipId }, { publishedPubliclyAt: null });

    return { clipId, reported: true };
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
