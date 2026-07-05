import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Challenge } from '../challenges/entities/challenge.entity';
import { PlayersModule } from '../players/players.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { TrainingLogEntry } from '../training-logs/entities/training-log-entry.entity';
import { WeeklyGoalController } from './weekly-goal.controller';
import { WeeklyGoalService } from './weekly-goal.service';

// "Veckans mål" (the weekly team goal) + dashboard/roster — ADR-0005,
// docs/api/phase2-contract.md. Registers TrainingLogEntry via its own
// forFeature (not by importing TrainingLogsModule) purely to read the
// team-wide progress aggregate — see WeeklyGoalService.computeTeamProgress
// — which keeps this module free of a dependency on TrainingLogsModule
// (which, in turn, imports *this* module for the bonus check, per
// TrainingLogsModule's comment — importing each other back would cycle).
@Module({
  imports: [
    TypeOrmModule.forFeature([Challenge, TrainingLogEntry]),
    AuthModule,
    PlayersModule,
    TeamPoolModule,
  ],
  controllers: [WeeklyGoalController],
  providers: [WeeklyGoalService],
  exports: [WeeklyGoalService],
})
export class WeeklyGoalModule {}
