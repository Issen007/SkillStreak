import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Team } from '../teams/entities/team.entity';
import { Season } from './entities/season.entity';
import { TeamSeasonPot } from './entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from './team-season-pot-status.enum';

export interface LeaderboardRow {
  rank: number;
  teamId: string;
  teamName: string;
  pointsTotal: number;
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
    let rank = 0;
    let previousPoints: number | null = null;
    return rows.map((row, index) => {
      if (previousPoints === null || row.pointsTotal !== previousPoints) {
        rank = index + 1;
      }
      previousPoints = row.pointsTotal;
      return {
        rank,
        teamId: row.teamId,
        teamName: row.teamName,
        pointsTotal: row.pointsTotal,
      };
    });
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
