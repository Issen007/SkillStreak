import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayersModule } from '../players/players.module';
import { RedisModule } from '../redis/redis.module';
import { TeamPoolModule } from '../team-pool/team-pool.module';
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
  ],
  controllers: [TrainingLogsController],
  providers: [TrainingLogsService],
})
export class TrainingLogsModule {}
