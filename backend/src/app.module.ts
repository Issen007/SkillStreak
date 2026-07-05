import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
    // Global default is deliberately generous — it's a backstop, not the
    // control that matters. The two genuinely open (unauthenticated)
    // routes — POST /players and GET /teams/invite/:inviteCode — override
    // this with a tighter, route-specific @Throttle() limit (see their
    // controllers). Every other route is authenticated (JwtAuthGuard), so
    // brute-forcing/spamming them already requires a valid session token.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 300,
      },
    ]),
    HealthModule,
    TeamsModule,
    TeamPoolModule,
    PlayerPrivateInfoModule,
    PlayersModule,
    OnboardingModule,
    TrainingLogsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
