import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  TrainingPlanDraft,
  TrainingPlanStatus,
} from './entities/training-plan-draft.entity';
import { DrillLibraryService } from '../drills/drill-library.service';
import { RequestTrainingPlanDto } from './dto/request-training-plan.dto';
import { TrainingPlanNotFoundException } from '../common/errors/exceptions';

/** What a coach sees. Never the lease id, never the raw failure. */
export interface TrainingPlanView {
  id: string;
  promptText: string;
  ageBand: string;
  durationMinutes: number;
  focus: string | null;
  locale: string;
  status: TrainingPlanStatus;
  generatedPlan: string | null;
  modelId: string | null;
  corpusVersion: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** What the generator is handed. No draft id, no staff account. */
export interface TrainingPlanJob {
  leaseId: string;
  promptText: string;
  ageBand: string;
  durationMinutes: number;
  focus: string | null;
  locale: string;
  /** The whole corpus, sent with the job — see selectDrills below. */
  drills: Array<{
    slug: string;
    title: string;
    ageBand: string;
    focus: string;
    durationMinutes: number;
    body: string;
  }>;
  corpusVersion: string;
}

function toView(draft: TrainingPlanDraft): TrainingPlanView {
  return {
    id: draft.id,
    promptText: draft.promptText,
    ageBand: draft.ageBand,
    durationMinutes: draft.durationMinutes,
    focus: draft.focus,
    locale: draft.locale,
    status: draft.status,
    generatedPlan: draft.generatedPlan,
    modelId: draft.modelId,
    corpusVersion: draft.corpusVersion,
    failureReason: draft.failureReason,
    createdAt: draft.createdAt.toISOString(),
    completedAt: draft.completedAt ? draft.completedAt.toISOString() : null,
  };
}

@Injectable()
export class TrainingPlansService {
  private readonly logger = new Logger(TrainingPlansService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly drillLibraryService: DrillLibraryService,
    @InjectRepository(TrainingPlanDraft)
    private readonly draftRepository: Repository<TrainingPlanDraft>,
  ) {}

  private number(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  private get attemptCap(): number {
    return this.number('TRAINING_PLAN_ATTEMPT_CAP', 3);
  }

  private get leaseSeconds(): number {
    // Longer than clip tagging's: text generation on an A2 is tens of
    // seconds, not one, and a lease that expires mid-generation would let
    // a second worker start the same job.
    return this.number('TRAINING_PLAN_LEASE_SECONDS', 600);
  }

  /** A coach's own queue depth, so one person cannot fill the queue. */
  private get maxQueuedPerStaff(): number {
    return this.number('TRAINING_PLAN_MAX_QUEUED', 3);
  }

  /**
   * Which drills go into the prompt.
   *
   * **Today: all of them.** The library is 2 drills / ~300 words and a
   * model's context holds thousands, so the entire corpus fits many times
   * over. Retrieval here would mean an embedding model, an index, and a
   * similarity search *to choose between two documents* — and retrieval
   * can pick the wrong one, where "send everything" structurally cannot.
   *
   * This function is the seam — and it takes no arguments on purpose.
   * A `request` parameter it never reads would be speculative generality
   * dressed up as foresight; when retrieval lands, adding the parameter
   * is part of that change and the call sites are two lines away. When
   * the corpus outgrows the context window (roughly 40 drills at current
   * length) this becomes a top-k embedding search and nothing else in the
   * app moves. Deferring it was the owner's call, 2026-08-12, and the
   * trigger is written down so it is revisited on evidence, not vibes.
   */
  private selectDrills(): TrainingPlanJob['drills'] {
    const all = this.drillLibraryService.list();
    return all
      .map((summary) => this.drillLibraryService.findBySlug(summary.slug))
      .filter((drill): drill is NonNullable<typeof drill> => Boolean(drill))
      .map((drill) => ({
        slug: drill.slug,
        title: drill.title,
        ageBand: drill.ageBand,
        focus: drill.focus,
        durationMinutes: drill.durationMinutes,
        body: drill.body,
      }));
  }

  /**
   * A stable identifier for the corpus that produced a plan.
   *
   * Slugs plus a count rather than a git sha: the sha of `ai/corpus/` that
   * ADR-0028 Decision 7 suggests is not available at runtime inside a
   * container, and a value the app cannot actually compute is worse than a
   * slightly coarser one it can. This changes whenever a drill is added or
   * removed, which is the question anyone reading a stored plan is
   * actually asking.
   */
  private corpusVersion(drills: TrainingPlanJob['drills']): string {
    return `${drills.length}:${drills
      .map((d) => d.slug)
      .sort()
      .join(',')}`.slice(0, 128);
  }

  async request(
    staffAccountId: string,
    dto: RequestTrainingPlanDto,
  ): Promise<TrainingPlanView> {
    const queued = await this.draftRepository.count({
      where: { staffAccountId, status: TrainingPlanStatus.QUEUED },
    });
    if (queued >= this.maxQueuedPerStaff) {
      // Not an error the coach caused by doing something wrong — they
      // just have work outstanding. Reuses the not-found exception's
      // sibling rather than inventing a status nobody handles.
      throw new TrainingPlanNotFoundException(
        `You already have ${queued} plans waiting. Open one of those first.`,
      );
    }

    const saved = await this.draftRepository.save(
      this.draftRepository.create({
        staffAccountId,
        promptText: dto.promptText.trim(),
        ageBand: dto.ageBand,
        durationMinutes: dto.durationMinutes,
        focus: dto.focus ?? null,
        locale: dto.locale ?? 'sv',
        status: TrainingPlanStatus.QUEUED,
      }),
    );
    return toView(saved);
  }

  /** A coach's own plans. Scoped to them; there is no route to anyone else's. */
  async listForStaff(staffAccountId: string): Promise<TrainingPlanView[]> {
    const drafts = await this.draftRepository.find({
      where: { staffAccountId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return drafts.map(toView);
  }

  async findOwned(
    staffAccountId: string,
    id: string,
  ): Promise<TrainingPlanView> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new TrainingPlanNotFoundException();
    }
    const draft = await this.draftRepository.findOne({
      where: { id, staffAccountId },
    });
    if (!draft) throw new TrainingPlanNotFoundException();
    return toView(draft);
  }

  /**
   * Delete one of the caller's own plans.
   *
   * ADR-0028 Decision 7(c)'s residual is that a coach can type a child's
   * name into a prompt, and an ADR-0013 erasure cannot find it because
   * this table deliberately has no `player_id`. That makes this the only
   * way such a name is removed before the 365-day sweep — so it exists,
   * and it is scoped to the caller's own rows like every other route
   * here.
   *
   * Hard delete, not a soft flag: the entire point is that the text
   * stops existing.
   */
  async deleteOwned(staffAccountId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new TrainingPlanNotFoundException();
    }
    const result = await this.draftRepository.delete({
      id,
      staffAccountId,
    });
    if (!result.affected) throw new TrainingPlanNotFoundException();
  }

  /**
   * Claim the next queued plan. One statement, for the same two reasons
   * the clip-tagging claim is one statement: atomicity, and TypeORM's
   * `query()` returning `[rows, count]` for `UPDATE ... RETURNING` but
   * plain rows for a SELECT — a trap that already cost a debugging session
   * once today.
   */
  async leaseNext(): Promise<TrainingPlanJob | null> {
    const rows: Array<{
      lease_id: string;
      prompt_text: string;
      age_band: string;
      duration_minutes: number;
      focus: string | null;
      locale: string;
    }> = await this.dataSource.query(
      // `status IN (queued, generating)` — not `= queued`.
      //
      // The first version filtered on `queued` while the same statement
      // set `generating`, which made the lease TTL decorative: once
      // leased, a row could never match again, so a worker killed
      // mid-generation (OOM, node loss, SIGKILL) stranded that plan
      // forever. The coach polled a spinner with no timeout, and the
      // admin panel built to notice a dead generator counted only
      // `queued` and so could not see it either.
      //
      // Including `generating` restores what the expiry was for: a lease
      // that has run out is reclaimable regardless of the status the
      // previous attempt left behind. `attempts` still bounds the retries.
      `WITH next_plan AS (
         SELECT id FROM training_plan_draft
          WHERE status = ANY($1) AND attempts < $2
            AND (leased_until IS NULL OR leased_until < now())
          ORDER BY created_at
          LIMIT 1 FOR UPDATE SKIP LOCKED
       ),
       leased AS (
         UPDATE training_plan_draft t
            SET lease_id = gen_random_uuid(),
                leased_until = now() + ($3 || ' seconds')::interval,
                attempts = t.attempts + 1,
                status = $4
           FROM next_plan n WHERE t.id = n.id
        RETURNING t.lease_id, t.prompt_text, t.age_band,
                  t.duration_minutes, t.focus, t.locale
       )
       SELECT * FROM leased`,
      [
        [TrainingPlanStatus.QUEUED, TrainingPlanStatus.GENERATING],
        this.attemptCap,
        String(this.leaseSeconds),
        TrainingPlanStatus.GENERATING,
      ],
    );

    if (!rows.length) return null;
    const row = rows[0];

    const drills = this.selectDrills();

    return {
      leaseId: row.lease_id,
      promptText: row.prompt_text,
      ageBand: row.age_band,
      durationMinutes: row.duration_minutes,
      focus: row.focus,
      locale: row.locale,
      drills,
      corpusVersion: this.corpusVersion(drills),
    };
  }

  async applyResult(
    leaseId: string,
    plan: string,
    provenance: { modelId: string; corpusVersion: string },
  ): Promise<{ applied: boolean }> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(TrainingPlanDraft)
      .set({
        status: TrainingPlanStatus.READY,
        generatedPlan: plan,
        modelId: provenance.modelId,
        corpusVersion: provenance.corpusVersion,
        leaseId: null,
        leasedUntil: null,
        completedAt: new Date(),
      })
      .where('lease_id = :leaseId', { leaseId })
      .andWhere('leased_until > now()')
      .execute();

    return { applied: (result.affected ?? 0) > 0 };
  }

  /**
   * The generator could not produce a plan.
   *
   * Below the attempt cap this returns the draft to `queued` so it is
   * retried; at the cap it becomes `failed` with a fixed phrase. The
   * phrase is deliberately not the model's error: a coach reading "CUDA
   * out of memory" learns nothing they can act on, and it leaks the
   * cluster's internals into an adult's work-product list.
   */
  async reportFailure(leaseId: string): Promise<{ applied: boolean }> {
    const rows: Array<{ id: string; attempts: number }> =
      await this.dataSource.query(
        `SELECT id, attempts FROM training_plan_draft WHERE lease_id = $1`,
        [leaseId],
      );
    if (!rows.length) return { applied: false };

    const exhausted = rows[0].attempts >= this.attemptCap;
    await this.dataSource.query(
      `UPDATE training_plan_draft
          SET status = $2,
              lease_id = NULL,
              leased_until = NULL,
              failure_reason = $3,
              completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
        WHERE id = $1`,
      [
        rows[0].id,
        exhausted ? TrainingPlanStatus.FAILED : TrainingPlanStatus.QUEUED,
        exhausted ? 'The generator could not produce a plan this time.' : null,
      ],
    );

    if (exhausted) {
      this.logger.warn(`Training plan ${rows[0].id} failed after retries.`);
    }
    return { applied: true };
  }
}
