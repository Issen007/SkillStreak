import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { WeeklyGoalModule } from '../weekly-goal/weekly-goal.module';
import { TrainingLogEntry } from './entities/training-log-entry.entity';
import { TrainingLogsController } from './training-logs.controller';
import { TrainingLogsService } from './training-logs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrainingLogEntry]),
    AuthModule,
    PlayersModule,
    TeamPoolModule,
    RedisModule,
    // ADR-0005 Decision 3: the goal-completion bonus check runs inside
    // this module's own transaction — see TrainingLogsService.logTraining.
    WeeklyGoalModule,
  ],
  controllers: [TrainingLogsController],
  providers: [TrainingLogsService],
})
export class TrainingLogsModule {}
