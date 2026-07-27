import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler-storage.service';
import { RedisThrottlerStorageModule } from './common/throttler/redis-throttler-storage.module';
import { ConsentModule } from './consent/consent.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PlayerPrivateInfoModule } from './player-private-info/player-private-info.module';
import { PlayersModule } from './players/players.module';
import { SessionModule } from './session/session.module';
import { TeamChatModule } from './team-chat/team-chat.module';
import { TeamPoolModule } from './team-pool/team-pool.module';
import { TeamsModule } from './teams/teams.module';
import { TrainingLogsModule } from './training-logs/training-logs.module';
import { VideoClipsModule } from './video-clips/video-clips.module';
import { WeeklyGoalModule } from './weekly-goal/weekly-goal.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    // Phase 3 (docs/adr/0010-video-storage-and-serving.md Decision 5) — the
    // daily retention sweep + hourly pending_upload TTL sweep run as
    // in-process @Cron tasks (ClipRetentionService), not a new Kubernetes
    // CronJob. Registered once, here, at the root (ScheduleModule.forRoot
    // is a singleton registration point, same as ThrottlerModule.forRoot
    // below).
    ScheduleModule.forRoot(),
    // Global default is deliberately generous — it's a backstop, not the
    // control that matters. The two genuinely open (unauthenticated)
    // routes — POST /players and GET /teams/invite/:inviteCode — override
    // this with a tighter, route-specific @Throttle() limit (see their
    // controllers). Every other route is authenticated (JwtAuthGuard), so
    // brute-forcing/spamming them already requires a valid session token.
    //
    // Redis-backed storage (RedisThrottlerStorage), not the library's
    // in-memory default — Fas 4 production-hardening, 2026-07-27. The
    // in-memory version keeps counters per-pod, so with
    // k8s/api-deployment.yaml's `replicas: 2` the real ceiling on
    // POST /players (the public website's signup wizard) was roughly
    // double the advertised 10/min/IP, flagged as required-before-real-
    // traffic in the Fas 2.9 security-reviewer sign-off. See
    // docs/ACTION_PLAN.md's Phase 4 section.
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: 300,
          },
        ],
        storage,
      }),
    }),
    HealthModule,
    MailModule,
    TeamsModule,
    TeamPoolModule,
    PlayerPrivateInfoModule,
    PlayersModule,
    OnboardingModule,
    ConsentModule,
    TrainingLogsModule,
    WeeklyGoalModule,
    SessionModule,
    TeamChatModule,
    VideoClipsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
