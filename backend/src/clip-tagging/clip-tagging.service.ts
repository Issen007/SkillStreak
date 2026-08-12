import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  VideoClip,
  VideoClipStatus,
  VideoClipTaggingStatus,
} from '../video-clips/entities/video-clip.entity';
import {
  VideoClipTag,
  VideoClipTagValue,
} from '../video-clips/entities/video-clip-tag.entity';
import { ClipFrameSamplerService } from './clip-frame-sampler.service';

export interface ClipTaggingLease {
  leaseId: string;
  /** Base64 JPEG stills. No id, no key, no URL, no duration, no team. */
  frames: string[];
}

export interface ClipTaggingScore {
  tag: string;
  score: number;
}

/**
 * The pull side of clip tagging.
 *
 * The owner chose option 2 (2026-08-12): the GPU cluster reaches out to
 * this cluster rather than the other way round, because the GPU cluster has
 * no public address and getting one is an infrastructure request. That
 * inverts the trust direction the original design leaned on, so the
 * controls that make it acceptable all live here:
 *
 * 1. **The worker never learns a clip id.** It is handed a random
 *    `leaseId` and some JPEG bytes. Nothing in the response, and nothing
 *    in any error, names a clip, a team, a player or a storage key. A
 *    fully compromised worker holds a pile of anonymous stills and a
 *    handful of opaque uuids.
 * 2. **The worker cannot ask for anything.** There is no "give me clip X"
 *    route. It can only say "give me whatever is next", and what is next
 *    is chosen entirely by this service.
 * 3. **A lease expires.** A worker that dies mid-clip releases its claim
 *    by doing nothing.
 * 4. **A lease is single-use.** Posting a result consumes it, so a replayed
 *    result cannot overwrite a later tagging run.
 * 5. **The vocabulary is enforced here, not there.** Every returned tag is
 *    checked against `VideoClipTagValue` and anything unrecognised is
 *    dropped with a warning. A model swap, a prompt change or a buggy
 *    worker can never write a novel label into Postgres.
 *
 * What this design does NOT defend against, stated plainly because the
 * reviewer should judge it rather than discover it: **anyone holding the
 * worker token can pull frames of children's training video, one clip at a
 * time, from the public internet.** The token is the whole boundary. The
 * mitigations are that the frames are downscaled to 224x224 (a face is a
 * dozen pixels), silent, metadata-stripped, and unlabelled — but they are
 * still derived images of children, and that is the cost of the GPU
 * cluster not having an address of its own.
 */
@Injectable()
export class ClipTaggingService {
  private readonly logger = new Logger(ClipTaggingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly clipFrameSamplerService: ClipFrameSamplerService,
  ) {}

  private number(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  /** Beyond this many failed attempts a clip is marked `failed` and stops
   *  being offered, so one pathological file cannot occupy the worker
   *  forever. */
  private get attemptCap(): number {
    return this.number('CLIP_TAGGING_ATTEMPT_CAP', 3);
  }

  private get leaseSeconds(): number {
    return this.number('CLIP_TAGGING_LEASE_SECONDS', 300);
  }

  private get frameCount(): number {
    return this.number('CLIP_TAGGING_FRAME_COUNT', 8);
  }

  /** Below this, a score is not a tag. Deliberately a config knob and not
   *  a constant: it is a product decision that must be tunable without
   *  rebuilding a GPU image, and it will move once the eval harness has
   *  run against real fixtures. */
  private get confidenceThreshold(): number {
    return this.number('CLIP_TAGGING_CONFIDENCE_THRESHOLD', 0.35);
  }

  /** How many tags one clip may carry, highest first. */
  private get maxTagsPerClip(): number {
    return this.number('CLIP_TAGGING_MAX_TAGS', 2);
  }

  /**
   * Claim the next untagged clip and return its frames.
   *
   * `FOR UPDATE SKIP LOCKED` so two workers (or two replicas of one) never
   * take the same row, without either blocking on the other. Returns null
   * when there is nothing to do, which the controller turns into a 204 —
   * "no work" is not an error and must not look like one.
   */
  async leaseNext(): Promise<ClipTaggingLease | null> {
    // Claim in ONE statement, for two reasons.
    //
    // Atomicity is the obvious one: the SELECT ... FOR UPDATE SKIP LOCKED
    // and the UPDATE cannot drift apart, so two workers (or two replicas)
    // never take the same row and neither blocks on the other.
    //
    // The other is a shape trap worth naming. TypeORM's `query()` returns
    // the row array for a SELECT but `[rows, affectedCount]` for an
    // `UPDATE ... RETURNING`. Written as two statements, `result[0]` is
    // the ROW in one case and the ROW ARRAY in the other — so
    // `result[0].tagging_lease_id` silently reads `undefined`, the lease
    // id never reaches the caller, and every clip fails with a lease id of
    // "undefined". That is exactly what happened here, and no unit test
    // caught it because a mocked repository returns whatever shape the
    // test author believed in. Wrapping the UPDATE in a CTE makes the
    // top-level statement a SELECT, whose return shape is unambiguous.
    const rows: Array<{
      storage_key: string;
      tagging_lease_id: string;
    }> = await this.dataSource.query(
      `WITH next_clip AS (
         SELECT id
           FROM video_clip
          WHERE tagging_status = $1
            AND status = $2
            AND tagging_attempts < $3
            AND (tagging_leased_until IS NULL OR tagging_leased_until < now())
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       ),
       leased AS (
         UPDATE video_clip v
            SET tagging_lease_id = gen_random_uuid(),
                tagging_leased_until = now() + ($4 || ' seconds')::interval,
                -- Counted at LEASE time, not at result time. A clip that
                -- kills the worker never reports back, so counting on
                -- success would retry it forever — which is precisely the
                -- case the cap exists for.
                tagging_attempts = v.tagging_attempts + 1
           FROM next_clip n
          WHERE v.id = n.id
        RETURNING v.storage_key, v.tagging_lease_id
       )
       SELECT storage_key, tagging_lease_id FROM leased`,
      [
        VideoClipTaggingStatus.NOT_PROCESSED,
        VideoClipStatus.PUBLISHED,
        this.attemptCap,
        String(this.leaseSeconds),
      ],
    );

    const claimed = rows.length
      ? { storageKey: rows[0].storage_key, leaseId: rows[0].tagging_lease_id }
      : null;

    if (!claimed) return null;

    let frames: Buffer[];
    try {
      frames = await this.clipFrameSamplerService.sample(
        claimed.storageKey,
        this.frameCount,
      );
    } catch (error) {
      // Release the lease immediately rather than making the worker wait
      // out a TTL for a clip this cluster could not read. The attempt is
      // already counted, so a permanently-broken file still converges on
      // `failed`.
      await this.releaseLease(claimed.leaseId);
      this.logger.error(
        `Frame sampling failed for lease ${claimed.leaseId}: ${String(error)}`,
      );
      return null;
    }

    if (!frames.length) {
      // A file that decodes to nothing is not going to start working.
      await this.finish(claimed.leaseId, VideoClipTaggingStatus.FAILED, []);
      return null;
    }

    return {
      leaseId: claimed.leaseId,
      frames: frames.map((frame) => frame.toString('base64')),
    };
  }

  /**
   * Apply a worker's scores.
   *
   * Returns quietly when the lease is unknown or expired — a late result
   * from a worker whose lease has already been reclaimed is a normal race,
   * not an error, and telling the caller which of the two it was would
   * leak whether a given uuid was ever a real lease.
   */
  async applyResult(
    leaseId: string,
    scores: ClipTaggingScore[],
    provenance: { modelId: string; promptSetVersion: string },
  ): Promise<{ applied: boolean }> {
    const accepted = scores
      .filter((score) => this.isKnownTag(score.tag))
      .filter((score) => score.score >= this.confidenceThreshold)
      // `unclear_or_unrelated` is never persisted as a row (Decision 5). A
      // stored one would be a durable machine-authored negative judgement
      // attached to one child's video, and this system does not make
      // those. Its meaning is carried by the absence of rows.
      .filter(
        (score) => score.tag !== String(VideoClipTagValue.UNCLEAR_OR_UNRELATED),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxTagsPerClip);

    const dropped = scores.filter((score) => !this.isKnownTag(score.tag));
    if (dropped.length) {
      // The tag NAMES are a fixed vocabulary and carry nothing about any
      // child, so logging them is safe and is the only way a prompt-set
      // drift becomes visible.
      this.logger.warn(
        `Dropped ${dropped.length} unrecognised tag(s) from the analyser: ` +
          dropped.map((score) => score.tag).join(', '),
      );
    }

    return this.finish(
      leaseId,
      accepted.length
        ? VideoClipTaggingStatus.TAGGED
        : VideoClipTaggingStatus.NO_CONFIDENT_TAGS,
      accepted,
      // `source` is what ADR-0018 Decision 4 left non-enum precisely so a
      // new model version needs no schema change. Recording model AND
      // prompt set together matters because a prompt edit changes scores
      // as surely as a model swap does, and without both a row cannot be
      // traced to what produced it.
      `${provenance.modelId}/${provenance.promptSetVersion}`,
    );
  }

  /** The worker could not score this clip. Frees the lease so the next
   *  attempt can happen immediately, up to the cap. */
  async reportFailure(leaseId: string): Promise<{ applied: boolean }> {
    const released = await this.releaseLease(leaseId);
    return { applied: released };
  }

  private isKnownTag(tag: string): tag is VideoClipTagValue {
    return (Object.values(VideoClipTagValue) as string[]).includes(tag);
  }

  private async releaseLease(leaseId: string): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(VideoClip)
      .set({ taggingLeaseId: null, taggingLeasedUntil: null })
      .where('tagging_lease_id = :leaseId', { leaseId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private async finish(
    leaseId: string,
    status: VideoClipTaggingStatus,
    tags: ClipTaggingScore[],
    source = 'unknown',
  ): Promise<{ applied: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      // The lease must still be live. Re-checked inside the transaction
      // and with a lock, so two results for one lease cannot both apply.
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT id
           FROM video_clip
          WHERE tagging_lease_id = $1
            AND tagging_leased_until > now()
          FOR UPDATE`,
        [leaseId],
      );
      if (!rows.length) return { applied: false };

      const clipId = rows[0].id;

      if (tags.length) {
        const repository = manager.getRepository(VideoClipTag);
        await repository.insert(
          tags.map((tag) => ({
            clipId,
            tag: tag.tag as VideoClipTagValue,
            // The column is numeric(4,3) with a CHECK that it sits in
            // [0, 1]. Clamped as well as rounded: the constraint is the
            // last line of defence against a buggy model, and a 500 from
            // a violated CHECK would strand the lease.
            confidence: Math.min(1, Math.max(0, Number(tag.score.toFixed(3)))),
            source,
          })),
        );
      }

      await manager.query(
        `UPDATE video_clip
            SET tagging_status = $2,
                tagging_lease_id = NULL,
                tagging_leased_until = NULL
          WHERE id = $1`,
        [clipId, status],
      );

      return { applied: true };
    });
  }
}
