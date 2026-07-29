import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlayersService } from '../players/players.service';
import { AccountErasureService } from './account-erasure.service';
import { AccountErasureRequest } from './entities/account-erasure-request.entity';

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
 * window). Inherits the same `replicas: 1` single-runner constraint already
 * documented in k8s/README.md for the other two sweeps in this codebase.
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
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweep(): Promise<void> {
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
        // the same run.
        this.logger.warn(
          `Failed to sweep account-erasure batch for team ${teamId} (${batchRows.length} row(s)) — left for the next run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
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
