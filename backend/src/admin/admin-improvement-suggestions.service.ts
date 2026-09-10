import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImprovementSuggestionNotFoundException } from '../common/errors/exceptions';
import { PlayerLocale } from '../common/locale/player-locale.enum';
import {
  ImprovementSuggestion,
  ImprovementSuggestionStatus,
} from '../improvement-suggestions/entities/improvement-suggestion.entity';
import { Player } from '../players/entities/player.entity';
import { Team } from '../teams/entities/team.entity';
import {
  ReporterIndex,
  resolveReporterIndex,
} from './admin-reporter-index.util';

/**
 * One suggestion as the Ideas queue renders it.
 *
 * **What is deliberately absent, and why each absence is load-bearing** —
 * identical to AdminBugReportRow, and for identical reasons:
 *
 * - **`realName` / `parentContact`** — this service has no repository for
 *   `player_private_info` at all, and this type has no field they could
 *   be put in.
 * - **`playerId`** — nothing in the console can use it. No filter, no
 *   search, no "other suggestions by this player" link, no drill-down;
 *   shipping the id anyway would put the one value a future contributor
 *   would need to build any of those onto the wire for free. ADR-0022
 *   Decision 5's own named anti-pattern is a per-player breakdown
 *   arriving through a table like this one instead of through
 *   `UsageMetricsService`.
 *
 * **`body`, `appVersion` and both identity fields are untrusted** and
 * must be HTML-escaped wherever the console renders them — including a
 * row's `title=` attribute. See admin-reporter-index.util.ts.
 */
export interface AdminImprovementSuggestionRow {
  id: string;
  createdAt: string;
  status: ImprovementSuggestionStatus;
  body: string;
  appVersion: string;
  locale: PlayerLocale;
  /**
   * `null` when the author's row can't be resolved. Shouldn't normally
   * happen — `player_id` is ON DELETE CASCADE, so an erasure takes the
   * suggestion with it — but the lookup is treated as optional rather
   * than asserted, so a referential edge case degrades to "suggestion
   * without a named author" instead of failing the whole page.
   */
  author: {
    screenName: string;
    teamName: string;
  } | null;
}

export interface AdminImprovementSuggestionsResponse {
  suggestions: AdminImprovementSuggestionRow[];
  /** Total matching the current filter, not the page. */
  total: number;
  limit: number;
  offset: number;
  /**
   * Per-status totals across the whole table, independent of the current
   * filter. Every status key is always present, including zeros, for the
   * same reason ADR-0020's funnel always emits every consent status: an
   * absent key is ambiguous between "none" and "not measured".
   */
  countsByStatus: Record<ImprovementSuggestionStatus, number>;
}

/**
 * docs/adr/0037-in-app-improvement-suggestions.md — the triage side.
 *
 * Like AdminBugReportsService, this shows individual-child data, and the
 * same argument justifies it: a suggestion is a voluntary,
 * single-incident, self-initiated submission by the child it is about —
 * the opposite shape from a standing capability to browse an arbitrary
 * child's behaviour. The boundaries that keep it that way are enforced
 * here (no author filter, no player id on the wire, no private-info
 * repository, no join into the usage-metrics pipeline) rather than left
 * to the frontend.
 */
@Injectable()
export class AdminImprovementSuggestionsService {
  constructor(
    @InjectRepository(ImprovementSuggestion)
    private readonly improvementSuggestionRepository: Repository<ImprovementSuggestion>,
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
  ) {}

  async list(options: {
    status?: ImprovementSuggestionStatus;
    limit: number;
    offset: number;
  }): Promise<AdminImprovementSuggestionsResponse> {
    const [suggestions, total] =
      await this.improvementSuggestionRepository.findAndCount({
        where: options.status ? { status: options.status } : {},
        // Fixed newest-first — the endpoint defines no sort parameter, so
        // the console renders no sortable headers rather than offering a
        // control that would only re-sort the loaded page. The `id`
        // tie-break matters with offset pagination: two rows written in
        // the same millisecond would otherwise page nondeterministically,
        // silently dropping or duplicating one between pages.
        order: { createdAt: 'DESC', id: 'DESC' },
        take: options.limit,
        skip: options.offset,
      });

    const authors = await this.resolveAuthors(suggestions);

    return {
      suggestions: suggestions.map((suggestion) =>
        toAdminImprovementSuggestionRow(suggestion, authors),
      ),
      total,
      limit: options.limit,
      offset: options.offset,
      countsByStatus: await this.countByStatus(),
    };
  }

  /**
   * Accepts **any** target status, including a backwards one
   * (`closed` → `open`). Deliberately no transition table and no
   * forward-only guard, for the reason ADR-0022 Decision 7 already
   * argued for bug reports: with one operator and no audit trail, an
   * irreversible mis-click is a worse failure than an unusual transition.
   */
  async updateStatus(
    suggestionId: string,
    status: ImprovementSuggestionStatus,
  ): Promise<AdminImprovementSuggestionRow> {
    const result = await this.improvementSuggestionRepository.update(
      { id: suggestionId },
      { status },
    );
    if (result.affected === 0) {
      // A designed-for case, not a defensive backstop: `player_id` is ON
      // DELETE CASCADE, so an account erasure removes the row while the
      // operator may still have it open.
      throw new ImprovementSuggestionNotFoundException();
    }

    const updated = await this.improvementSuggestionRepository.findOne({
      where: { id: suggestionId },
    });
    if (!updated) {
      // Erased in the window between the UPDATE above and this read.
      throw new ImprovementSuggestionNotFoundException();
    }

    const authors = await this.resolveAuthors([updated]);
    return toAdminImprovementSuggestionRow(updated, authors);
  }

  /** Shared with the bug-report queue — see
   * admin-reporter-index.util.ts for what it deliberately cannot read. */
  private resolveAuthors(
    suggestions: ImprovementSuggestion[],
  ): Promise<ReporterIndex> {
    return resolveReporterIndex({
      playerRepository: this.playerRepository,
      teamRepository: this.teamRepository,
      playerIds: suggestions.map((suggestion) => suggestion.playerId),
    });
  }

  private async countByStatus(): Promise<
    Record<ImprovementSuggestionStatus, number>
  > {
    const rows = await this.improvementSuggestionRepository
      .createQueryBuilder('suggestion')
      .select('suggestion.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('suggestion.status')
      .getRawMany<{ status: ImprovementSuggestionStatus; count: string }>();

    const counts: Record<ImprovementSuggestionStatus, number> = {
      [ImprovementSuggestionStatus.OPEN]: 0,
      [ImprovementSuggestionStatus.TRIAGED]: 0,
      [ImprovementSuggestionStatus.CLOSED]: 0,
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
 * Field-by-field, never a spread of the entity: `ImprovementSuggestion`
 * carries `playerId`, and a spread would put it on the wire the moment
 * anyone stopped reading. Exported for its own unit test — "this response
 * contains no player id and no private-info field" is a security
 * property, not a formatting detail.
 */
export function toAdminImprovementSuggestionRow(
  suggestion: ImprovementSuggestion,
  authors: ReporterIndex,
): AdminImprovementSuggestionRow {
  return {
    id: suggestion.id,
    createdAt: suggestion.createdAt.toISOString(),
    status: suggestion.status,
    body: suggestion.body,
    appVersion: suggestion.appVersion,
    locale: suggestion.locale,
    author: authors.get(suggestion.playerId) ?? null,
  };
}
