import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClipNotFoundException } from '../common/errors/exceptions';
import {
  ClipModerationDecision,
  ClipModerationDecisionKind,
} from './entities/clip-moderation-decision.entity';
import { ClipReportReason } from './entities/clip-report.entity';
import { VideoClip, VideoClipStatus } from './entities/video-clip.entity';

/**
 * One reported clip awaiting a decision.
 *
 * Carries the reasons given and how many people reported it, because a
 * clip reported once for `not_training_related` and one reported by four
 * teammates for `bullying` want different attention, and an operator
 * reading a flat list cannot tell them apart.
 *
 * **Never carries who reported it.** `clip_report`'s own guarantee is
 * that no response anywhere returns a reporter to any player, and while
 * an operator is not a player, naming the reporter here would put it one
 * careless join from a screen — and would change what reporting costs a
 * child who is afraid of the person they are reporting.
 */
export interface ReportedClipItem {
  clipId: string;
  uploaderScreenName: string;
  teamName: string;
  reportCount: number;
  reasons: ClipReportReason[];
  firstReportedAt: string;
  /** Short-lived, minted per request. */
  playbackUrl: string;
}

/**
 * docs/design/clip-safety.md layer 4 — the back half of report-and-take-down.
 *
 * The front half has worked since ADR-0010 Decision 4: one report hides a
 * clip instantly, no threshold, no quorum. What was missing is everything
 * after: a queue, a record of what was decided, and **any way to put back
 * a clip reported in error** — which until now made "report" a one-way
 * door any teammate could operate.
 */
@Injectable()
export class AdminClipModerationService {
  constructor(
    @InjectRepository(VideoClip)
    private readonly clips: Repository<VideoClip>,
    @InjectRepository(ClipModerationDecision)
    private readonly decisions: Repository<ClipModerationDecision>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Clips reported since anybody last ruled on them.
   *
   * "Since" is the load-bearing word. A clip dismissed in March and
   * reported again in April is back in the queue, because the second
   * report is a new claim and the old decision did not consider it. A
   * plain "has no decision" filter would silently drop it — the worst
   * failure this queue could have, since a re-report is exactly the case
   * where somebody disagreed with the first call.
   *
   * Oldest first: a backlog must not starve its bottom, and the clip
   * waiting longest belongs to the child most likely to have concluded
   * the app ate their video.
   */
  async listPending(
    mintPlaybackUrl: (storageKey: string) => Promise<string>,
  ): Promise<ReportedClipItem[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select([
        'clip.id AS "clipId"',
        'clip.storage_key AS "storageKey"',
        'player.screen_name AS "screenName"',
        'team.name AS "teamName"',
        'COUNT(r.id) AS "reportCount"',
        'MIN(r.created_at) AS "firstReportedAt"',
        'ARRAY_AGG(DISTINCT r.reason::text) AS "reasons"',
      ])
      .from(VideoClip, 'clip')
      .innerJoin('clip_report', 'r', 'r.clip_id = clip.id')
      .innerJoin('player', 'player', 'player.id = clip.uploader_player_id')
      .innerJoin('team', 'team', 'team.id = clip.team_id')
      .where('clip.status = :hidden', { hidden: VideoClipStatus.HIDDEN })
      // No decision that is newer than the newest report for this clip.
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM clip_moderation_decision d
           WHERE d.clip_id = clip.id
             AND d.created_at >= (
               SELECT MAX(r2.created_at) FROM clip_report r2 WHERE r2.clip_id = clip.id
             )
         )`,
      )
      .groupBy('clip.id')
      .addGroupBy('clip.storage_key')
      .addGroupBy('player.screen_name')
      .addGroupBy('team.name')
      .orderBy('MIN(r.created_at)', 'ASC')
      .limit(100)
      .getRawMany<{
        clipId: string;
        storageKey: string;
        screenName: string;
        teamName: string;
        reportCount: string;
        firstReportedAt: Date;
        reasons: string[];
      }>();

    return Promise.all(
      rows.map(async (row) => ({
        clipId: row.clipId,
        uploaderScreenName: row.screenName,
        teamName: row.teamName,
        reportCount: Number(row.reportCount),
        reasons: row.reasons as ClipReportReason[],
        firstReportedAt: row.firstReportedAt.toISOString(),
        playbackUrl: await mintPlaybackUrl(row.storageKey),
      })),
    );
  }

  /** The report was right. The clip stays hidden; the judgement is recorded. */
  async uphold(
    clipId: string,
    staffAccountId: string,
    note?: string,
  ): Promise<void> {
    await this.decide(
      clipId,
      staffAccountId,
      ClipModerationDecisionKind.UPHELD,
      note,
    );
  }

  /**
   * The report was wrong, or does not warrant hiding. The clip goes back.
   *
   * **This is the capability that did not exist**, and its absence made a
   * report irreversible by anyone. A teammate could remove another child's
   * clip permanently, for any reason or none, and nobody could undo it.
   *
   * Restores to `published`, which returns it to its team feed. It does
   * NOT make it public again on its own: the public feed additionally
   * requires an operator's approval (layer 3), and that gate is untouched
   * here.
   */
  async dismiss(
    clipId: string,
    staffAccountId: string,
    note?: string,
  ): Promise<void> {
    await this.decide(
      clipId,
      staffAccountId,
      ClipModerationDecisionKind.DISMISSED,
      note,
    );
  }

  private async decide(
    clipId: string,
    staffAccountId: string,
    decision: ClipModerationDecisionKind,
    note?: string,
  ): Promise<void> {
    // One transaction: a decision recorded without the clip moving, or a
    // clip restored with no record of who restored it, are both worse
    // than the operation failing and being retried.
    await this.dataSource.transaction(async (manager) => {
      const clip = await manager.findOne(VideoClip, {
        where: { id: clipId, status: VideoClipStatus.HIDDEN },
      });
      if (!clip) throw new ClipNotFoundException();

      if (decision === ClipModerationDecisionKind.DISMISSED) {
        await manager.update(
          VideoClip,
          { id: clipId },
          { status: VideoClipStatus.PUBLISHED },
        );
      }

      await manager.insert(ClipModerationDecision, {
        clipId,
        decidedByStaffAccountId: staffAccountId,
        decision,
        note: note?.trim().slice(0, 300) ?? null,
      });
    });
  }
}
