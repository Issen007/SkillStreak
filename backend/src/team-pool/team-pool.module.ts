import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Season } from './entities/season.entity';
import { TeamSeasonPot } from './entities/team-season-pot.entity';
import { TeamPoolService } from './team-pool.service';

@Module({
  imports: [TypeOrmModule.forFeature([TeamSeasonPot, Season])],
  providers: [TeamPoolService],
  exports: [TeamPoolService],
})
export class TeamPoolModule {}
