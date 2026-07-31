import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { stockholmDateString } from '../common/time/stockholm-date.util';
import { Team } from '../teams/entities/team.entity';
import { Player } from '../players/entities/player.entity';
import { ParentalConsentStatus } from '../players/player-consent-status.enum';
import { TeamJoinStatus } from '../players/team-join-status.enum';
import { computeHalfYearSeason } from './half-year-season.util';
import { Season } from './entities/season.entity';
import { DEFAULT_TEAM_SEASON_POT_GOAL_THRESHOLD } from './team-season-pot-defaults';
import { TeamSeasonPot } from './entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from './team-season-pot-status.enum';

export interface LeaderboardRow {
  rank: number;
  teamId: string;
  teamName: string;
  pointsTotal: number;
}

// docs/adr/0016-cross-team-leaderboard-fairness.md Decision 4/5 — the
// shrinkage-adjusted "effort" view alongside the raw-total LeaderboardRow
// above. eligiblePlayerCount reuses ADR-0015 Decision 2's exact eligibility
// definition (parentalConsentStatus = 'approved' AND teamJoinStatus =
// 'approved'); pointsPerPlayer is the honest, unadjusted teamAverage;
// adjustedScore is the shrinkage-adjusted number rank is computed from.
export interface EffortLeaderboardRow {
  rank: number;
  teamId: string;
  teamName: string;
  eligiblePlayerCount: number;
  pointsPerPlayer: number;
  adjustedScore: number;
}

// The raw shape queryActivePotsWithEligibleCounts returns — every team with
// an active pot, including eligiblePlayerCount === 0 (kept in this
// intermediate shape, not yet filtered, so getEffortRankAndEligibleCountOrThrow
// can report a requesting team's own eligiblePlayerCount even when it's 0
// and therefore absent from the ranked EffortLeaderboardRow[] output).
interface TeamPoolEligibleCountRow {
  teamId: string;
  teamName: string;
  pointsTotal: number;
  eligiblePlayerCount: number;
}

// Team-pool logic (the shared, season-long point pool) — kept as its own
// module deliberately separate from individual streak logic
// (PlayersService/RedisService streak keys), per CLAUDE.md: different reset
// rules (a season/month vs a missed day) and different storage shape
// (Postgres ledger here is authoritative; Redis only caches the gauge).
@Injectable()
export class TeamPoolService {
  constructor(
    @InjectRepository(TeamSeasonPot)
    private readonly teamSeasonPotRepository: Repository<TeamSeasonPot>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
  ) {}

  async getActivePotForTeam(
    teamId: string,
    manager?: EntityManager,
  ): Promise<TeamSeasonPot> {
    const repository = manager
      ? manager.getRepository(TeamSeasonPot)
      : this.teamSeasonPotRepository;
    const pot = await repository.findOne({
      where: { teamId, status: TeamSeasonPotStatus.ACTIVE },
      order: { id: 'ASC' },
    });
    if (!pot) {
      // Operational/setup gap, not a client-input error: Phase 1 has no
      // coach-facing season/pot management endpoints yet, so this can only
      // happen if a team was seeded without an active pot. Surfaced as a
      // clear 500 rather than silently doing nothing to a training log.
      throw new InternalServerErrorException(
        `Team ${teamId} has no active TeamSeasonPot configured.`,
      );
    }
    return pot;
  }

  async getSeason(
    seasonId: string,
    manager?: EntityManager,
  ): Promise<Season | null> {
    const repository = manager
      ? manager.getRepository(Season)
      : this.seasonRepository;
    return repository.findOne({ where: { id: seasonId } });
  }

  /**
   * docs/adr/0009-self-service-team-creation.md Decision 6 — called only
   * from OnboardingService.createPlayer's transaction, only when that
   * request just created a brand-new team (never for an ordinary join, and
   * never touching an existing team's pot). Closes "a self-created team can
   * be born without a pot" — the exact failure mode getActivePotForTeam
   * above already guards against with a 500. label/startDate/endDate are
   * computed from *today's* Europe/Stockholm calendar date via the same
   * fixed Jan-Jun/Jul-Dec grid src/scripts/seed.ts already hard-codes for
   * its own seeded season, not a floating "today + N days" window (see the
   * ADR for why: keeping every team's season aligned to the same calendar
   * grid is what keeps ADR-0008's cross-team leaderboard comparison from
   * gaining a second season-shape variable). goalThreshold reuses the
   * seed's own constant, not a second hardcoded number.
   */
  async createInitialSeasonAndPot(
    manager: EntityManager,
    teamId: string,
  ): Promise<{ season: Season; pot: TeamSeasonPot }> {
    const { label, startDate, endDate } = computeHalfYearSeason(
      stockholmDateString(),
    );

    const seasonRepository = manager.getRepository(Season);
    const season = await seasonRepository.save(
      seasonRepository.create({ teamId, label, startDate, endDate }),
    );

    const potRepository = manager.getRepository(TeamSeasonPot);
    const pot = await potRepository.save(
      potRepository.create({
        teamId,
        seasonId: season.id,
        pointsTotal: 0,
        goalThreshold: DEFAULT_TEAM_SEASON_POT_GOAL_THRESHOLD,
        status: TeamSeasonPotStatus.ACTIVE,
      }),
    );

    return { season, pot };
  }

  /**
   * Atomic increment (a single `UPDATE ... SET points_total = points_total
   * + $1` statement) rather than read-modify-write, so concurrent
   * training-log writes from different players on the same team can never
   * lose an update.
   */
  async addPoints(
    manager: EntityManager,
    teamSeasonPotId: string,
    points: number,
  ): Promise<TeamSeasonPot> {
    const repository = manager.getRepository(TeamSeasonPot);
    await repository.increment({ id: teamSeasonPotId }, 'pointsTotal', points);
    const updated = await repository.findOne({
      where: { id: teamSeasonPotId },
    });
    if (!updated) {
      throw new InternalServerErrorException(
        `TeamSeasonPot ${teamSeasonPotId} disappeared mid-transaction.`,
      );
    }
    return updated;
  }

  // --- Fas 2.7: the cross-team leaderboard ----------------------------------
  // docs/adr/0008-vm-guld-cross-team-leaderboard.md.

  /**
   * ADR-0008 Decision 1's entire query, verbatim: exactly two tables
   * (team_season_pot JOIN team), filtered to status = 'active', sorted
   * descending by points_total. Structurally cannot return anything from
   * Player/PlayerPrivateInfo — neither is named here. A team with no
   * currently-active pot is simply absent, not shown at zero or erroring
   * the whole query (different posture from getActivePotForTeam, which
   * throws for the *requesting* team's own missing pot — see the ADR).
   */
  private async queryActivePotsWithTeamNames(): Promise<
    Array<{ teamId: string; teamName: string; pointsTotal: number }>
  > {
    const rows = await this.teamSeasonPotRepository
      .createQueryBuilder('pot')
      .innerJoin(Team, 'team', 'team.id = pot.team_id')
      .select('team.id', 'teamId')
      .addSelect('team.name', 'teamName')
      .addSelect('pot.points_total', 'pointsTotal')
      .where('pot.status = :status', { status: TeamSeasonPotStatus.ACTIVE })
      .orderBy('pot.points_total', 'DESC')
      // Stable secondary order for ties, so repeated calls (leaderboard +
      // a team's own rank on a different request) can't disagree about
      // which of two equally-scored teams is listed first.
      .addOrderBy('team.id', 'ASC')
      .getRawMany<{ teamId: string; teamName: string; pointsTotal: string }>();

    return rows.map((row) => ({
      teamId: row.teamId,
      teamName: row.teamName,
      pointsTotal: Number(row.pointsTotal),
    }));
  }

  // --- ADR-0016: cross-team leaderboard fairness (roster-size normalization) --

  /**
   * ADR-0016 Decision 4's query, verbatim: the same two tables as
   * queryActivePotsWithTeamNames above, plus a count-only LEFT JOIN to
   * Player. Selects nothing from Player except a COUNT — no screenName, no
   * playerId, no consent/join status column, nothing that identifies or
   * describes any individual child (the ADR's Decision 4 privacy
   * reasoning). eligiblePlayerCount reuses ADR-0015 Decision 2's exact
   * eligibility predicate. `C`/`k`/`adjustedScore` are computed afterward in
   * application code (computeEffortLeaderboard) — no second query.
   */
  private async queryActivePotsWithEligibleCounts(): Promise<
    TeamPoolEligibleCountRow[]
  > {
    const rows = await this.teamSeasonPotRepository
      .createQueryBuilder('pot')
      .innerJoin(Team, 'team', 'team.id = pot.team_id')
      .leftJoin(Player, 'player', 'player.team_id = team.id')
      .select('team.id', 'teamId')
      .addSelect('team.name', 'teamName')
      .addSelect('pot.points_total', 'pointsTotal')
      .addSelect(
        'COUNT(player.id) FILTER (WHERE player.parental_consent_status = :consentApproved AND player.team_join_status = :joinApproved)',
        'eligiblePlayerCount',
      )
      .where('pot.status = :status', { status: TeamSeasonPotStatus.ACTIVE })
      .groupBy('team.id')
      .addGroupBy('team.name')
      .addGroupBy('pot.points_total')
      .setParameters({
        consentApproved: ParentalConsentStatus.APPROVED,
        joinApproved: TeamJoinStatus.APPROVED,
      })
      .getRawMany<{
        teamId: string;
        teamName: string;
        pointsTotal: string;
        eligiblePlayerCount: string;
      }>();

    return rows.map((row) => ({
      teamId: row.teamId,
      teamName: row.teamName,
      pointsTotal: Number(row.pointsTotal),
      eligiblePlayerCount: Number(row.eligiblePlayerCount),
    }));
  }

  /**
   * ADR-0016 Decision 1 — the additive "effort" view alongside the existing
   * raw-total getLeaderboard() above, backing effortLeaderboard/
   * requestingTeamEffort on GET /teams/:teamId/leaderboard.
   */
  async getEffortLeaderboard(): Promise<EffortLeaderboardRow[]> {
    const rows = await this.queryActivePotsWithEligibleCounts();
    return TeamPoolService.computeEffortLeaderboard(rows);
  }

  /**
   * The dashboard/`me` home-card addition (ADR-0016 Decision 5):
   * `effortRank` alongside the existing `rank`. Returns `effortRank: null`
   * when the requesting team's own eligiblePlayerCount is 0 (excluded from
   * the effort view entirely, same posture as requestingTeamEffort's own
   * null case) rather than throwing — unlike getRankAndTeamCountOrThrow,
   * "this team has zero eligible players" is an ordinary, expected state
   * (e.g. every player still consent-pending), not an operational setup
   * gap. Only ever called for a team whose own active pot was just
   * successfully resolved by the caller, same "can't occur given the
   * contract" posture as getRankAndTeamCountOrThrow for the pot-missing
   * case itself.
   */
  async getEffortRankAndEligibleCountOrThrow(
    teamId: string,
  ): Promise<{ effortRank: number | null; eligiblePlayerCount: number }> {
    const rows = await this.queryActivePotsWithEligibleCounts();
    const mine = rows.find((row) => row.teamId === teamId);
    if (!mine) {
      throw new InternalServerErrorException(
        `Team ${teamId} has an active TeamSeasonPot but is missing from its own eligible-count computation.`,
      );
    }
    if (mine.eligiblePlayerCount === 0) {
      return { effortRank: null, eligiblePlayerCount: 0 };
    }
    const effortLeaderboard = TeamPoolService.computeEffortLeaderboard(rows);
    const entry = effortLeaderboard.find((row) => row.teamId === teamId);
    if (!entry) {
      throw new InternalServerErrorException(
        `Team ${teamId} has eligiblePlayerCount > 0 but is missing from its own effort-leaderboard computation.`,
      );
    }
    return {
      effortRank: entry.rank,
      eligiblePlayerCount: mine.eligiblePlayerCount,
    };
  }

  /**
   * Standard competition ranking (ties share the lower rank number, the
   * next distinct score skips accordingly — "1, 2, 2, 4", never "1, 2, 2,
   * 3") — computed once, here, so the leaderboard list and every team's own
   * `rank` field (dashboard, GET /players/me, this endpoint's
   * `requestingTeam` block) agree by construction rather than being
   * re-derived three different ways (ADR-0008 Decision 3 / the contract's
   * implementer note). `rows` must already be sorted descending by
   * pointsTotal (queryActivePotsWithTeamNames guarantees this).
   */
  static computeStandardCompetitionRanks(
    rows: Array<{ teamId: string; teamName: string; pointsTotal: number }>,
  ): LeaderboardRow[] {
    return TeamPoolService.rankByScoreDescending(
      rows,
      (row) => row.pointsTotal,
    );
  }

  /**
   * ADR-0016 Decision 3 — the same standard-competition-ranking tie-handling
   * as computeStandardCompetitionRanks above, generalized over any
   * already-sorted-descending row set and score accessor so the raw-total
   * and effort views share one ranking implementation rather than two
   * hand-written copies of the same tie logic.
   */
  private static rankByScoreDescending<
    T extends { teamId: string; teamName: string },
  >(rows: T[], getScore: (row: T) => number): Array<T & { rank: number }> {
    let rank = 0;
    let previousScore: number | null = null;
    return rows.map((row, index) => {
      const score = getScore(row);
      if (previousScore === null || score !== previousScore) {
        rank = index + 1;
      }
      previousScore = score;
      return { ...row, rank };
    });
  }

  /** The middle value, not the mean — see ADR-0016 Decision 2 on why k uses
   * the median (so one large outlier roster can't skew the shrinkage
   * constant). Even-length inputs average the two middle values, the
   * standard median definition. */
  private static median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private static round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  /**
   * docs/adr/0016-cross-team-leaderboard-fairness.md's 2026-07-31 addendum
   * — buckets an exact eligiblePlayerCount into a coarse range for
   * cross-team-visible response fields only (weekly-goal.service.ts's
   * getLeaderboard() applies this at the HTTP-response-building layer, not
   * here). A team of 1-2 players makes the exact count a de-facto
   * consent/join-approval status for a single, identifiable child; bucketing
   * closes that leak while keeping the "why did a small team out-rank a big
   * one" legibility the effort view exists for. Pure, static — does not
   * change EffortLeaderboardRow, computeEffortLeaderboard(),
   * getEffortLeaderboard(), or getEffortRankAndEligibleCountOrThrow(), all
   * of which keep returning/consuming the exact integer. Never called with
   * n === 0 — those rows are already excluded before this point (Decision
   * 2's "absent, not shown at zero").
   */
  static bucketEligiblePlayerCount(n: number): '1-2' | '3-5' | '6+' {
    if (n <= 2) return '1-2';
    if (n <= 5) return '3-5';
    return '6+';
  }

  /**
   * ADR-0016 Decision 2's shrinkage formula, applied to an already-fetched
   * eligible-count row set (no second query — Decision 4). Teams with
   * eligiblePlayerCount === 0 are excluded entirely, same "absent, not
   * shown at zero" posture as a team with no active pot on the raw
   * leaderboard. Pure function, tested directly against the ADR's worked
   * example rather than only through an e2e round-trip, same posture as
   * computeStandardCompetitionRanks.
   */
  static computeEffortLeaderboard(
    rows: TeamPoolEligibleCountRow[],
  ): EffortLeaderboardRow[] {
    const qualifying = rows.filter((row) => row.eligiblePlayerCount > 0);
    if (qualifying.length === 0) {
      return [];
    }

    const totalPoints = qualifying.reduce(
      (sum, row) => sum + row.pointsTotal,
      0,
    );
    const totalEligiblePlayers = qualifying.reduce(
      (sum, row) => sum + row.eligiblePlayerCount,
      0,
    );
    // C — the league-wide pooled average, not a mean-of-team-averages.
    const leagueMean = totalPoints / totalEligiblePlayers;
    // k — GREATEST(3, median(eligiblePlayerCount)), computed live from the
    // current data, floored at 3 so it can't collapse to a tiny number
    // while the beta only has a handful of teams seeded.
    const k = Math.max(
      3,
      TeamPoolService.median(qualifying.map((row) => row.eligiblePlayerCount)),
    );

    const scored = qualifying.map((row) => {
      const n = row.eligiblePlayerCount;
      const teamAverage = row.pointsTotal / n;
      const adjustedScore =
        (n / (n + k)) * teamAverage + (k / (n + k)) * leagueMean;
      return {
        teamId: row.teamId,
        teamName: row.teamName,
        eligiblePlayerCount: n,
        // Kept at full precision through sorting/ranking so a tie that
        // only appears after 1-decimal display rounding doesn't produce a
        // rank disagreeing with the displayed numbers; rounded only below,
        // for output.
        pointsPerPlayerRaw: teamAverage,
        adjustedScoreRaw: adjustedScore,
      };
    });

    scored.sort((a, b) => {
      const diff = b.adjustedScoreRaw - a.adjustedScoreRaw;
      if (diff !== 0) return diff;
      // Stable secondary order for genuine ties, matching
      // queryActivePotsWithTeamNames's own tie-break.
      return a.teamId.localeCompare(b.teamId);
    });

    const ranked = TeamPoolService.rankByScoreDescending(
      scored,
      (row) => row.adjustedScoreRaw,
    );

    return ranked.map((row) => ({
      rank: row.rank,
      teamId: row.teamId,
      teamName: row.teamName,
      eligiblePlayerCount: row.eligiblePlayerCount,
      pointsPerPlayer: TeamPoolService.round1(row.pointsPerPlayerRaw),
      adjustedScore: TeamPoolService.round1(row.adjustedScoreRaw),
    }));
  }

  /**
   * The one shared query method every read path reuses (leaderboard
   * endpoint, dashboard, GET /players/me) — per the contract's implementer
   * note not to compute rank/teamCount three slightly different ways.
   */
  async getLeaderboard(): Promise<LeaderboardRow[]> {
    const rows = await this.queryActivePotsWithTeamNames();
    return TeamPoolService.computeStandardCompetitionRanks(rows);
  }

  /**
   * The dashboard/`me` home-card addition (ADR-0008 Decision 3): `rank` = 1
   * + count of active pots with a strictly greater pointsTotal; `teamCount`
   * = count of teams currently on the leaderboard at all. Only ever called
   * for a team whose own active pot was just successfully resolved by the
   * caller (getActivePotForTeam already throws otherwise), so a missing
   * entry here would mean the leaderboard computation and
   * getActivePotForTeam disagree about "does this team have an active
   * pot" — a "can't occur given the API contract" state, not a normal
   * 404, per CLAUDE.md's boundary-validation posture.
   */
  async getRankAndTeamCountOrThrow(
    teamId: string,
  ): Promise<{ rank: number; teamCount: number }> {
    const leaderboard = await this.getLeaderboard();
    const entry = leaderboard.find((row) => row.teamId === teamId);
    if (!entry) {
      throw new InternalServerErrorException(
        `Team ${teamId} has an active TeamSeasonPot but is missing from its own leaderboard computation.`,
      );
    }
    return { rank: entry.rank, teamCount: leaderboard.length };
  }
}
