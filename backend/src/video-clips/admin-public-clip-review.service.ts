import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ClipNotFoundException } from '../common/errors/exceptions';
import {
  PublicClipReviewStatus,
  VideoClip,
  VideoClipStatus,
} from './entities/video-clip.entity';

/**
 * One clip waiting for an operator to watch it.
 *
 * **Carries the uploader's screen name and team, and that is a
 * deliberate exception to how this project usually builds admin views.**
 * The error log holds no child reference by construction; this cannot
 * work that way, because the decision being made is about a specific
 * child's video and an operator who cannot tell whose it is cannot judge
 * whether the child in it is the one who uploaded it — which is precisely
 * risk 2 in docs/design/clip-safety.md.
 *
 * The real name is still never here. Screen name and team are what the
 * child's own teammates already see.
 */
export interface PublicClipReviewItem {
  clipId: string;
  requestedAt: string;
  durationSeconds: number | null;
  uploaderScreenName: string;
  teamName: string;
  /** Short-lived, minted per request — never a durable URL. */
  playbackUrl: string;
}

/**
 * docs/design/clip-safety.md layer 3 — the operator queue in front of the
 * public feed.
 *
 * Modelled on `AdminTrainerPostsService` rather than invented: same
 * pending/approve/reject shape, so there is one set of operator habits
 * rather than two that drift apart.
 */
@Injectable()
export class AdminPublicClipReviewService {
  constructor(
    @InjectRepository(VideoClip)
    private readonly clips: Repository<VideoClip>,
  ) {}

  /**
   * Oldest first, deliberately.
   *
   * A newest-first queue starves the bottom when a backlog forms, and the
   * clip that has waited longest is the one whose uploader is most likely
   * to have concluded the feature is broken.
   */
  async listPending(
    mintPlaybackUrl: (storageKey: string) => Promise<string>,
  ): Promise<PublicClipReviewItem[]> {
    const rows = await this.clips
      .createQueryBuilder('clip')
      .innerJoin('player', 'player', 'player.id = clip.uploader_player_id')
      .innerJoin('team', 'team', 'team.id = clip.team_id')
      .select([
        'clip.id AS "clipId"',
        'clip.published_publicly_at AS "requestedAt"',
        'clip.duration_seconds AS "durationSeconds"',
        'clip.storage_key AS "storageKey"',
        'player.screen_name AS "screenName"',
        'team.name AS "teamName"',
      ])
      .where('clip.public_review_status = :pending', {
        pending: PublicClipReviewStatus.PENDING,
      })
      // A clip hidden by a report is out of the queue: it is already
      // invisible everywhere, and asking an operator to rule on the
      // public feed for something no longer in any feed is busywork.
      .andWhere('clip.status = :published', {
        published: VideoClipStatus.PUBLISHED,
      })
      .andWhere('clip.published_publicly_at IS NOT NULL')
      .orderBy('clip.published_publicly_at', 'ASC')
      .limit(100)
      .getRawMany<{
        clipId: string;
        requestedAt: Date;
        durationSeconds: number | null;
        storageKey: string;
        screenName: string;
        teamName: string;
      }>();

    return Promise.all(
      rows.map(async ({ storageKey, screenName, requestedAt, ...row }) => ({
        ...row,
        requestedAt: requestedAt.toISOString(),
        uploaderScreenName: screenName,
        playbackUrl: await mintPlaybackUrl(storageKey),
      })),
    );
  }

  async approve(clipId: string, staffAccountId: string): Promise<void> {
    await this.decide(clipId, staffAccountId, {
      publicReviewStatus: PublicClipReviewStatus.APPROVED,
      publicReviewRejectionReason: null,
    });
  }

  /**
   * Refuse it, with a reason the uploader can act on.
   *
   * **Does not clear `published_publicly_at`.** That column means "the
   * child asked", and it stays true — clearing it would erase the request
   * and make a rejected clip indistinguishable from one nobody ever tried
   * to publish, including to the child, who would simply see their action
   * undone with no explanation.
   */
  async reject(
    clipId: string,
    staffAccountId: string,
    reason: string,
  ): Promise<void> {
    await this.decide(clipId, staffAccountId, {
      publicReviewStatus: PublicClipReviewStatus.REJECTED,
      publicReviewRejectionReason: reason.trim().slice(0, 300),
    });
  }

  private async decide(
    clipId: string,
    staffAccountId: string,
    fields: Partial<VideoClip>,
  ): Promise<void> {
    const result = await this.clips.update(
      {
        id: clipId,
        // Only a clip somebody actually asked to publish can be ruled on.
        // Without this, a stray id would silently mark an unrelated
        // private clip as reviewed.
        publishedPubliclyAt: Not(IsNull()),
      },
      {
        ...fields,
        publicReviewedAt: new Date(),
        publicReviewedByStaffAccountId: staffAccountId,
      },
    );
    if (!result.affected) throw new ClipNotFoundException();
  }
}
