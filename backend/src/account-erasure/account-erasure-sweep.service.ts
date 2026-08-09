import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ERROR_LOG_JOB_NAMES } from '../error-log/error-log.constants';
import { ErrorLogService } from '../error-log/error-log.service';
import { PlayersService } from '../players/players.service';
import { RedisService } from '../redis/redis.service';
import { AccountErasureService } from './account-erasure.service';
import { AccountErasureRequest } from './entities/account-erasure-request.entity';

// k8s/README.md's now-resolved "Scheduled-job races" note — same reasoning
// as ClipRetentionService's identical constant: generous headroom for a
// daily sweep, short enough that a crashed pod's stale claim doesn't
// matter by the next day's tick.
const SCHEDULED_JOB_LOCK_TTL_SECONDS = 5 * 60;

function groupByTeam(
  rows: AccountErasureRequest[],
): Map<string, AccountErasureRequest[]> {
  const byTeam = new Map<string, AccountErasureRequest[]>();
  for (const row of rows) {
    const existing = byTeam.get(row.teamId);
    if (existing) {
      existing.push(row);
    } else {
      byTeam.set(row.teamId, [row]);
    }
  }
  return byTeam;
}

/**
 * docs/adr/0013-account-erasure.md Decision 5/8 — the scheduled sweep,
 * mirroring ClipRetentionService's shape (`@nestjs/schedule`, not new
 * Kubernetes CronJob infrastructure; daily is plenty granular for a 30-day
 * window).
 *
 * The one thing this class does that ClipRetentionService's per-row sweep
 * doesn't need to: **group due rows by team_id before processing any of
 * them** (the security-reviewer's 2026-07-29 refinement to Decision 5) —
 * "am I the last player on this team" has to account for every OTHER
 * player from the same team whose erasure is executing in this exact same
 * run, not just the team's currently-stored roster count, since this run
 * processes rows with no ordering guarantee (same posture
 * ClipRetentionService already has, deliberately not strengthened here
 * either).
 *
 * Now safe under 2+ replicas (k8s/api-deployment.yaml is back to
 * `replicas: 2`): `sweep` opens by calling
 * RedisService.tryClaimScheduledJobRun('account-erasure:sweep', ...) and
 * returns immediately if it loses — same non-blocking try-lock shape as
 * ClipRetentionService's two sweeps, not the blocking Postgres advisory
 * lock the migration step uses (see
 * backend/src/scripts/migrate-with-lock.ts) — see that service's own
 * docstring for why the two need different lock shapes.
 *
 * All the actual per-team/per-row execution logic lives on
 * AccountErasureService (see its executeTeamCascade/executeSingleErasure
 * methods' own comments for why) — this class is deliberately just the
 * cron trigger + the team-batching/dispatch loop + the
 * per-team-batch-failure isolation.
 */
@Injectable()
export class AccountErasureSweepService {
  private readonly logger = new Logger(AccountErasureSweepService.name);

  constructor(
    private readonly accountErasureService: AccountErasureService,
    private readonly playersService: PlayersService,
    private readonly redisService: RedisService,
    private readonly errorLogService: ErrorLogService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweep(): Promise<void> {
    const jobName = ERROR_LOG_JOB_NAMES.accountErasureSweep;
    if (!(await this.tryClaimJobOrSkip(jobName))) {
      return;
    }

    try {
      const dueRows = await this.accountErasureService.findDueRows();
      if (dueRows.length === 0) return;

      const byTeam = groupByTeam(dueRows);
      this.logger.log(
        `Sweeping ${dueRows.length} due account-erasure request(s) across ${byTeam.size} team(s).`,
      );

      for (const [teamId, batchRows] of byTeam) {
        try {
          await this.processTeamBatch(teamId, batchRows);
        } catch (error) {
          // Same per-batch try/catch/leave-for-next-run posture as
          // ClipRetentionService — a failure on one team's batch is logged
          // and retried the next day, never blocks another team's batch in
          // the same run. Deliberately logger-only, like
          // ClipRetentionService's per-row catch: the run-level catch below
          // is what writes a durable ADR-0022 Decision 6 row, so one broken
          // dependency can't write a row per team per run.
          this.logger.warn(
            `Failed to sweep account-erasure batch for team ${teamId} (${batchRows.length} row(s)) — left for the next run: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      // docs/adr/0022-admin-control-center.md Decision 6 — a failure of the
      // sweep as a whole (findDueRows, the roster lookup that feeds the
      // batching, anything outside a per-batch catch) is recorded rather
      // than left to reject out of the `@Cron` handler unobserved.
      this.logger.error(
        `${jobName} failed — left for the next run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.errorLogService.record({ source: 'job', jobName, error });
    }
  }

  /**
   * code-critic's review of the replicas:2 fix caught this: with no
   * try/catch here, a Redis hiccup would reject out of the `@Cron` handler
   * uncaught — `@nestjs/schedule`'s underlying `cron` package does catch
   * that (the process doesn't crash), but only via a raw `console.error`,
   * not this app's own `Logger`, making a real Redis-connectivity problem
   * here quietly less visible than every other degraded-but-non-fatal
   * failure path in this codebase (see the per-batch try/catch a few lines
   * below for the existing convention this matches). Treated the same as
   * "another replica already claimed this run" either way — skip this
   * tick, don't crash the whole sweep over a transient lock-check failure
   * — but now logged through `this.logger.warn` so it shows up like
   * everything else.
   */
  private async tryClaimJobOrSkip(jobName: string): Promise<boolean> {
    try {
      const claimed = await this.redisService.tryClaimScheduledJobRun(
        jobName,
        SCHEDULED_JOB_LOCK_TTL_SECONDS,
      );
      if (!claimed) {
        this.logger.debug(
          `Skipping ${jobName} — another replica already claimed this run.`,
        );
      }
      return claimed;
    } catch (error) {
      this.logger.warn(
        `Skipping ${jobName} this tick — failed to check the Redis run-lock: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async processTeamBatch(
    teamId: string,
    batchRows: AccountErasureRequest[],
  ): Promise<void> {
    const roster = await this.playersService.listByTeam(teamId);
    const batchPlayerIds = batchRows.map((row) => row.playerId);
    const survivingCount = roster.filter(
      (player) => !batchPlayerIds.includes(player.id),
    ).length;

    if (survivingCount === 0) {
      // Every remaining player on the team is being executed in this same
      // run (including, trivially, the ordinary single-player case) — the
      // whole batch is the last-player path, once, for the team as a
      // whole. A captain auto-fallback is never attempted for any row in
      // this batch: there is nobody left to hand off to.
      await this.accountErasureService.executeTeamCascade(teamId, batchRows);
      return;
    }

    // The team continues — process each row individually, drawing any
    // needed captain auto-fallback candidate only from the surviving set
    // (current roster minus this ENTIRE batch, passed as
    // excludeFromFallback below), never from another player in the same
    // batch, regardless of what order these rows happen to process in.
    for (const row of batchRows) {
      await this.accountErasureService.executeSingleErasure(
        row,
        batchPlayerIds,
      );
    }
  }
}
