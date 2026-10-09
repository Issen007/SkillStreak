import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
import { WeeklyGoalModule } from '../weekly-goal/weekly-goal.module';
import { TrainingLogEntry } from './entities/training-log-entry.entity';
import { TrainingTimer } from './entities/training-timer.entity';
import { VideoClip } from '../video-clips/entities/video-clip.entity';
import { TrainingLogsController } from './training-logs.controller';
import { TrainingLogsService } from './training-logs.service';
import { TrainingTimersController } from './training-timers.controller';
import { TrainingTimersService } from './training-timers.service';

@Module({
  imports: [
    // VideoClip is registered directly rather than by importing
    // VideoClipsModule: docs/adr/0025 only needs to READ a clip row to
    // validate it as evidence, and pulling in that module's services would
    // hand the training-log path the ability to mint upload URLs and
    // publish clips, which it has no business doing. Same technique
    // UsageMetricsModule and AdminModule already use for read-only access.
    TypeOrmModule.forFeature([TrainingLogEntry, TrainingTimer, VideoClip]),
    AuthModule,
    PlayersModule,
    TeamPoolModule,
    RedisModule,
    // ADR-0005 Decision 3: the goal-completion bonus check runs inside
    // this module's own transaction — see TrainingLogsService.logTraining.
    WeeklyGoalModule,
  ],
  // TrainingTimers (docs/adr/0038) live here rather than in a module of
  // their own: a timer exists only to be consumed by a training log, inside
  // TrainingLogsService's own transaction.
  controllers: [TrainingLogsController, TrainingTimersController],
  providers: [TrainingLogsService, TrainingTimersService],
})
export class TrainingLogsModule {}
