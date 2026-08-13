import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface TrainingPlanStats {
  statusCounts: Record<string, number>;
  totalPlans: number;
  /** Queued right now. Grows without bound if the generator is down. */
  queued: number;
  /** Failed after exhausting retries — the number that means something
   *  is wrong rather than merely slow. */
  failed: number;
  /** Which models produced the stored plans. */
  models: Array<{ modelId: string; count: number }>;
  /** How long the oldest queued plan has been waiting, in seconds. Null
   *  when nothing is queued. */
  oldestQueuedSeconds: number | null;
}

/**
 * Aggregates for the console (ADR-0028 Decision 13 — "what the admin
 * console shows, because the failure mode is silence").
 *
 * That framing is the whole reason this exists. The generator lives on a
 * cluster with no inbound route and no HTTP endpoint; if it stops, nothing
 * errors, no probe fails, and no coach complains until one happens to ask
 * for a session. `oldestQueuedSeconds` is the number that surfaces it: a
 * queue that is not draining says the generator is gone, and says it
 * without anyone needing to hold a kubeconfig.
 *
 * App-wide counts only. No staff account parameter, no plan id, no prompt
 * text — the prompts are adults' own words and may, per ADR-0028 Decision
 * 7(c), contain a name however much the design discourages it. An
 * operator counting jobs has no business reading them.
 */
@Injectable()
export class TrainingPlanStatsService {
  constructor(private readonly dataSource: DataSource) {}

  async collect(): Promise<TrainingPlanStats> {
    const statusRows: Array<{ status: string; count: string }> =
      await this.dataSource.query(
        `SELECT status, count(*)::text AS count
           FROM training_plan_draft GROUP BY status`,
      );

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) {
      statusCounts[row.status] = Number(row.count);
    }

    const modelRows: Array<{ model_id: string; count: string }> =
      await this.dataSource.query(
        `SELECT model_id, count(*)::text AS count
           FROM training_plan_draft
          WHERE model_id IS NOT NULL
          GROUP BY model_id ORDER BY count(*) DESC`,
      );

    const waitRows: Array<{ seconds: string | null }> =
      await this.dataSource.query(
        `SELECT EXTRACT(EPOCH FROM (now() - min(created_at)))::text AS seconds
           FROM training_plan_draft WHERE status = 'queued'`,
      );

    const seconds = waitRows[0]?.seconds;

    return {
      statusCounts,
      totalPlans: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      queued: statusCounts.queued ?? 0,
      failed: statusCounts.failed ?? 0,
      models: modelRows.map((row) => ({
        modelId: row.model_id,
        count: Number(row.count),
      })),
      oldestQueuedSeconds:
        seconds === null || seconds === undefined
          ? null
          : Math.round(Number(seconds)),
    };
  }
}
