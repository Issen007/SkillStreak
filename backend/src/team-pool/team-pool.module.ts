import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from '../teams/entities/team.entity';
import { Season } from './entities/season.entity';
import { TeamSeasonPot } from './entities/team-season-pot.entity';
import { TeamPoolService } from './team-pool.service';

// Registers Team directly (rather than importing TeamsModule) purely so
// TeamPoolService.getLeaderboard can join team_season_pot -> team for the
// team's name — ADR-0008's Decision 1: exactly two tables, never Player/
// PlayerPrivateInfo. Team carries no sensitive data of its own (name/
// invite_code only), so this is not a boundary concern the way importing
// PlayerPrivateInfoModule would be.
@Module({
  imports: [TypeOrmModule.forFeature([TeamSeasonPot, Season, Team])],
  providers: [TeamPoolService],
  exports: [TeamPoolService],
})
export class TeamPoolModule {}
