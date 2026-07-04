import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PlayerPrivateInfoModule } from './player-private-info/player-private-info.module';
import { PlayersModule } from './players/players.module';
import { TeamPoolModule } from './team-pool/team-pool.module';
import { TeamsModule } from './teams/teams.module';
import { TrainingLogsModule } from './training-logs/training-logs.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    TeamsModule,
    TeamPoolModule,
    PlayerPrivateInfoModule,
    PlayersModule,
    OnboardingModule,
    TrainingLogsModule,
  ],
})
export class AppModule {}
