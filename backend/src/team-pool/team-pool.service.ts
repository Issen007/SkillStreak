import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Season } from './entities/season.entity';
import { TeamSeasonPot } from './entities/team-season-pot.entity';
import { TeamSeasonPotStatus } from './team-season-pot-status.enum';

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

  static percentComplete(pointsTotal: number, goalThreshold: number): number {
    if (goalThreshold <= 0) return 0;
    // One decimal place, matching the contract's example (25.6).
    return Math.round((pointsTotal / goalThreshold) * 1000) / 10;
  }
}
