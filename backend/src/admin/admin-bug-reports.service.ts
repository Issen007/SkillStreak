import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BugReport,
  BugReportCategory,
  BugReportPlatform,
  BugReportScreen,
  BugReportStatus,
} from '../bug-reports/entities/bug-report.entity';
import { BugReportNotFoundException } from '../common/errors/exceptions';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import { Player } from '../players/entities/player.entity';
import { Team } from '../teams/entities/team.entity';

/**
 * One report as the triage queue renders it (docs/design/phase7-admin-
 * console-flows.md §6.1).
 *
 * **What is deliberately absent, and why each absence is load-bearing:**
 *
 * - **`realName` / `parentContact`** — §6.3 and §13: reporter identity is
 *   screen name + team name, full stop. Both of those values live in the
 *   ADR-0002-addendum-isolated `player_private_info` table, encrypted at
 *   rest, and this service has no repository for that table at all — the
 *   same "don't give the module the ability in the first place" technique
 *   UsageMetricsModule already uses. This type having no field for them is
 *   the second layer, not the only one.
 * - **`playerId`** — nothing in the console can use it. §6.3 forbids a
 *   filter, a search, an "other reports by this player" link, and a
 *   drill-down; shipping the id anyway would put the one value a future
 *   contributor would need to build any of those onto the wire for free.
 *   Decision 5's own named anti-pattern is a per-player breakdown arriving
 *   through this table rather than through `UsageMetricsService`.
 *
 * **Every string field below except the enums is untrusted** —
 * `description`, `appVersion`, `osVersion`, **and both identity fields**.
 * §6.2 verified directly that `screenName`/`teamName` have no charset
 * validation anywhere in `backend/src`, so both are stored-XSS carriers into
 * a page holding the admin session, exactly like the three fields Decision
 * 7's 2026-08-02 correction named. The console must render all five with
 * `textContent`/`html-escape.util.ts`, never `innerHTML` — including the
 * list row's `title=` attribute.
 */
export interface AdminBugReportRow {
  id: string;
  createdAt: string;
  status: BugReportStatus;
  category: BugReportCategory;
  screen: BugReportScreen;
  platform: BugReportPlatform;
  appVersion: string;
  osVersion: string | null;
  locale: PlayerLocale;
  description: string | null;
  /**
   * `null` when the reporter's row can't be resolved. Shouldn't normally
   * happen — `player_id` is ON DELETE CASCADE, so an erasure takes the
   * report with it — but the lookup is treated as optional rather than
   * asserted, so a referential edge case degrades to "report without a
   * named reporter" instead of failing the whole page.
   */
  reporter: {
    screenName: string;
    teamName: string;
  } | null;
}

export interface AdminBugReportsResponse {
  reports: AdminBugReportRow[];
  /** Total matching the current filter, not the page. */
  total: number;
  limit: number;
  offset: number;
  /**
   * Per-status totals across the whole table, independent of the current
   * filter — §13: "confirm the list response carries per-status counts, or
   * AD3's chips show no numbers." Every status key is always present,
   * including zeros, for the same reason ADR-0020's funnel always emits
   * every consent status: an absent key is ambiguous between "none" and
   * "not measured".
   */
  countsByStatus: Record<BugReportStatus, number>;
}

/** Screen name + team name for the reporters on one page, keyed by player
 * id. Built from two narrow, explicitly-`select`ed reads rather than a
 * TypeORM relation — see resolveReporters. */
type ReporterIndex = Map<string, { screenName: string; teamName: string }>;

/**
 * docs/adr/0022-admin-control-center.md Decision 7's triage side.
 *
 * This is the one place in that ADR that legitimately shows individual-child
 * data, and Decision 7 argues at length why that isn't a hole in Decision
 * 5's aggregate-only floor: a bug report is a voluntary, single-incident,
 * self-initiated submission by the child it's about — the opposite shape
 * from a standing capability to browse an arbitrary child's behaviour. The
 * boundaries that keep it that way are enforced here (no reporter filter, no
 * player id on the wire, no private-info repository, no join into the
 * usage-metrics pipeline) rather than left to the frontend.
 */
@Injectable()
export class AdminBugReportsService {
  constructor(
    @InjectRepository(BugReport)
    private readonly bugReportRepository: Repository<BugReport>,
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
  ) {}

  async list(options: {
    status?: BugReportStatus;
    limit: number;
    offset: number;
  }): Promise<AdminBugReportsResponse> {
    const [reports, total] = await this.bugReportRepository.findAndCount({
      where: options.status ? { status: options.status } : {},
      // Fixed newest-first (§6.1) — the endpoint defines no sort parameter,
      // so the console renders no sortable headers rather than offering a
      // control that would only re-sort the loaded page. The `id` tie-break
      // matters with offset pagination: two reports written in the same
      // millisecond would otherwise page nondeterministically, silently
      // dropping or duplicating a row between pages.
      order: { createdAt: 'DESC', id: 'DESC' },
      take: options.limit,
      skip: options.offset,
    });

    const reporters = await this.resolveReporters(reports);

    return {
      reports: reports.map((report) => toAdminBugReportRow(report, reporters)),
      total,
      limit: options.limit,
      offset: options.offset,
      countsByStatus: await this.countByStatus(),
    };
  }

  /**
   * Accepts **any** target status, including a backwards one
   * (`closed` → `open`) — §6.4/§13. Deliberately no transition table and no
   * forward-only guard: with one operator and no audit trail, an
   * irreversible mis-click is a worse failure than an unusual transition,
   * and the alternative sends the operator to `psql` — the exact thing this
   * console exists to replace.
   */
  async updateStatus(
    bugReportId: string,
    status: BugReportStatus,
  ): Promise<AdminBugReportRow> {
    const result = await this.bugReportRepository.update(
      { id: bugReportId },
      { status },
    );
    if (result.affected === 0) {
      // A designed-for case, not a defensive backstop: `player_id` is ON
      // DELETE CASCADE, so an account erasure removes the row while the
      // operator may still have it open. §6.4's `gone` state renders "the
      // reporter's account was probably erased" off this 404.
      throw new BugReportNotFoundException();
    }

    const updated = await this.bugReportRepository.findOne({
      where: { id: bugReportId },
    });
    if (!updated) {
      // Erased in the window between the UPDATE above and this read.
      throw new BugReportNotFoundException();
    }

    const reporters = await this.resolveReporters([updated]);
    return toAdminBugReportRow(updated, reporters);
  }

  /**
   * Two narrow reads instead of a TypeORM relation, deliberately: `select`
   * naming exactly three player columns and exactly two team columns is what
   * keeps this path from ever widening into "the whole Player row" if
   * someone later adds a column, and it makes the absence of any
   * `player_private_info` read visible in one glance.
   */
  private async resolveReporters(reports: BugReport[]): Promise<ReporterIndex> {
    const index: ReporterIndex = new Map();
    const playerIds = [...new Set(reports.map((report) => report.playerId))];
    if (playerIds.length === 0) return index;

    const players = await this.playerRepository.find({
      where: { id: In(playerIds) },
      select: { id: true, screenName: true, teamId: true },
    });
    if (players.length === 0) return index;

    const teamIds = [...new Set(players.map((player) => player.teamId))];
    const teams = await this.teamRepository.find({
      where: { id: In(teamIds) },
      select: { id: true, name: true },
    });
    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

    for (const player of players) {
      index.set(player.id, {
        screenName: player.screenName,
        // Team name is included because reproduction genuinely depends on
        // team shape (roster size, whether a pot is active) — §6.3. `''` is
        // the degenerate "team row vanished" case, not a normal one.
        teamName: teamNameById.get(player.teamId) ?? '',
      });
    }
    return index;
  }

  private async countByStatus(): Promise<Record<BugReportStatus, number>> {
    const rows = await this.bugReportRepository
      .createQueryBuilder('report')
      .select('report.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('report.status')
      .getRawMany<{ status: BugReportStatus; count: string }>();

    const counts: Record<BugReportStatus, number> = {
      [BugReportStatus.OPEN]: 0,
      [BugReportStatus.TRIAGED]: 0,
      [BugReportStatus.CLOSED]: 0,
    };
    for (const row of rows) {
      // pg returns COUNT(*) as a string (bigint) — parsed, never coerced
      // implicitly.
      counts[row.status] = Number(row.count);
    }
    return counts;
  }
}

/**
 * Field-by-field, never a spread of the entity: `BugReport` carries
 * `playerId`, and a spread would put it on the wire the moment anyone
 * stopped reading. Exported for its own unit test — "this response contains
 * no private-info field" is a security property, not a formatting detail.
 */
export function toAdminBugReportRow(
  report: BugReport,
  reporters: ReporterIndex,
): AdminBugReportRow {
  return {
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    status: report.status,
    category: report.category,
    screen: report.screen,
    platform: report.platform,
    appVersion: report.appVersion,
    osVersion: report.osVersion,
    locale: report.locale,
    description: report.description,
    reporter: reporters.get(report.playerId) ?? null,
  };
}
