import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ClipTaggingStats {
  /** Every published clip, by where it got to. */
  statusCounts: Record<string, number>;
  /** How many published clips exist at all — the denominator. */
  publishedClips: number;
  /**
   * The number this panel exists for: of the clips the model has actually
   * looked at, what fraction did it decline to tag?
   *
   * Null until anything has been processed, rather than 0 — "nothing has
   * run yet" and "it tags everything confidently" are opposite findings
   * and must not render identically.
   */
  silentRate: number | null;
  /** Distribution over the fixed vocabulary. No clip ids, no players. */
  tagCounts: Array<{ tag: string; count: number; averageConfidence: number }>;
  /** Which model and prompt wording produced the stored rows. */
  sources: Array<{ source: string; count: number }>;
  /** Clips that failed enough times to be given up on. */
  failed: number;
  /** Waiting to be leased. Grows if the worker is down. */
  pending: number;
}

/**
 * Aggregates for the console's tagging panel.
 *
 * Built instead of a fixture-set evaluation (Open Question 5, decided
 * 2026-08-12). The reasoning: the pipeline is already tagging real clips
 * for free, so the distribution it produces is continuous evidence about
 * whether this model works on *this* project's actual footage — at no
 * cost, and without anyone filming anything. A fixture set is more
 * rigorous and remains the way to set a threshold, but it measures
 * something no code currently reads, and at 7 clips a human coach is
 * still better than any classifier at every question worth asking.
 *
 * **Aggregate only, and structurally so.** Every method here returns
 * counts over the whole app. There is no team parameter, no player
 * parameter, no clip id, and no date-and-team combination — the same
 * posture ADR-0020 Decision 5 takes for analytics, and for the same
 * reason: this must never become a way to ask what a particular child has
 * been training. There is no shape in these types for such a filter to be
 * wired to, which is a stronger guarantee than a rule saying not to.
 *
 * The tag NAMES are a fixed, closed vocabulary and describe an activity,
 * not a person, so counting them carries nothing about anybody.
 */
@Injectable()
export class ClipTaggingStatsService {
  constructor(private readonly dataSource: DataSource) {}

  async collect(): Promise<ClipTaggingStats> {
    const statusRows: Array<{ tagging_status: string; count: string }> =
      await this.dataSource.query(
        `SELECT tagging_status, count(*)::text AS count
           FROM video_clip
          WHERE status = 'published'
          GROUP BY tagging_status`,
      );

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) {
      statusCounts[row.tagging_status] = Number(row.count);
    }

    const publishedClips = Object.values(statusCounts).reduce(
      (total, count) => total + count,
      0,
    );

    const tagged = statusCounts.tagged ?? 0;
    const silent = statusCounts.no_confident_tags ?? 0;
    const processed = tagged + silent;

    const tagRows: Array<{ tag: string; count: string; avg: string }> =
      await this.dataSource.query(
        `SELECT tag, count(*)::text AS count, avg(confidence)::text AS avg
           FROM video_clip_tag
          GROUP BY tag
          ORDER BY count(*) DESC`,
      );

    const sourceRows: Array<{ source: string; count: string }> =
      await this.dataSource.query(
        `SELECT source, count(*)::text AS count
           FROM video_clip_tag
          GROUP BY source
          ORDER BY count(*) DESC`,
      );

    return {
      statusCounts,
      publishedClips,
      // Guarded rather than defaulted: see the field's own comment.
      silentRate: processed > 0 ? silent / processed : null,
      tagCounts: tagRows.map((row) => ({
        tag: row.tag,
        count: Number(row.count),
        averageConfidence: Number(Number(row.avg).toFixed(3)),
      })),
      sources: sourceRows.map((row) => ({
        source: row.source,
        count: Number(row.count),
      })),
      failed: statusCounts.failed ?? 0,
      pending: statusCounts.not_processed ?? 0,
    };
  }
}
