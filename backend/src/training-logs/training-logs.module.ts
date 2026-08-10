import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { WeeklyGoalModule } from '../weekly-goal/weekly-goal.module';
import { TrainingLogEntry } from './entities/training-log-entry.entity';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { TrainingLogsController } from './training-logs.controller';
import { TrainingLogsService } from './training-logs.service';

@Module({
  imports: [
    // VideoClip is registered directly rather than by importing
    // VideoClipsModule: docs/adr/0025 only needs to READ a clip row to
    // validate it as evidence, and pulling in that module's services would
    // hand the training-log path the ability to mint upload URLs and
    // publish clips, which it has no business doing. Same technique
    // UsageMetricsModule and AdminModule already use for read-only access.
    TypeOrmModule.forFeature([TrainingLogEntry, VideoClip]),
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
