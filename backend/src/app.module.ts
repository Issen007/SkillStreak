import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountErasureModule } from './account-erasure/account-erasure.module';
import { AdminModule } from './admin/admin.module';
import { AppConfigModule } from './config/app-config.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BugReportsModule } from './bug-reports/bug-reports.module';
import { EventRegistrationsModule } from './event-registrations/event-registrations.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler-storage.service';
import { RedisThrottlerStorageModule } from './common/throttler/redis-throttler-storage.module';
import { ConsentModule } from './consent/consent.module';
import { DatabaseModule } from './database/database.module';
import { AppExceptionFilter } from './common/errors/http-exception.filter';
import { ErrorLogModule } from './error-log/error-log.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PlayerPrivateInfoModule } from './player-private-info/player-private-info.module';
import { PlayersModule } from './players/players.module';
import { ProfileModule } from './profile/profile.module';
import { PtModule } from './pt/pt.module';
import { SessionModule } from './session/session.module';
import { StaffAuthModule } from './staff-auth/staff-auth.module';
import { TeamChatModule } from './team-chat/team-chat.module';
import { TeamPoolModule } from './team-pool/team-pool.module';
import { TeamsModule } from './teams/teams.module';
import { TrainingLogsModule } from './training-logs/training-logs.module';
import { UsageMetricsModule } from './usage-metrics/usage-metrics.module';
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
            // Added 2026-07-27 alongside the Redis-backed storage change
            // above: e2e tests (test/*.e2e-spec.ts) run many separate
            // spec files, each creating a fresh Nest app instance but all
            // sharing one real Redis instance and one client IP
            // (127.0.0.1 via supertest) — with in-memory storage this
            // didn't matter (a fresh app = a fresh in-memory Map = a
            // fresh counter per file), but Redis-backed counters persist
            // across every file in the run, so POST /players' 10/min/IP
            // throttle was tripping on unrelated later test files. No
            // e2e test exercises the throttle-triggers-429 case itself
            // (the storage math has its own dedicated unit tests,
            // redis-throttler-storage.service.spec.ts, and was live-
            // verified against the real cluster — see docs/ACTION_PLAN.md's
            // Phase 4 section), so skipping it in test env costs no
            // coverage.
            skipIf: () => process.env.NODE_ENV === 'test',
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
    ProfileModule,
    TeamChatModule,
    VideoClipsModule,
    AccountErasureModule,
    // docs/adr/0023-pt-role-and-staff-sso-rbac.md Part B — staff (admin/pt)
    // SSO login + the two RBAC guards. ADR-0022's own admin-console
    // endpoints are still a separate, not-yet-built follow-up — this
    // module only exposes the account/session mechanism itself
    // (/api/v1/staff-auth/*).
    StaffAuthModule,
    // docs/adr/0023-pt-role-and-staff-sso-rbac.md Part A — the PT role's
    // two-step consent chain (PtTeamLink/PtPlayerConsent) and its
    // read-only, allow-listed data surface (/api/v1/pt/*,
    // /api/v1/teams/:teamId/pt-links/*, /api/v1/pt-consent*,
    // /api/v1/players/me/pt-consents/*).
    PtModule,
    // docs/adr/0020-usage-analytics-product-metrics.md — Fas 5 item 1: a
    // scheduled, in-process job (ScheduleModule.forRoot above already
    // registers the mechanism) that emails the project owner an aggregate
    // usage report. No controller, no endpoint, no exports — see that
    // module's own docstring.
    UsageMetricsModule,
    // docs/adr/0022-admin-control-center.md Decision 6 — the write side of
    // the error/crash + failed-job pipeline (ErrorLogService + its daily
    // retention sweep). Imported here for the APP_FILTER below; the three
    // modules owning a @Cron job import it themselves. The admin read
    // endpoint (GET /api/v1/admin/errors) lives in AdminModule below —
    // this one has no controller.
    ErrorLogModule,
    // docs/adr/0022-admin-control-center.md Decision 7 — the player-facing
    // "Report a problem" submission (POST /api/v1/bug-reports, JwtAuthGuard,
    // deliberately not consent-gated; see that module/service's docstrings).
    AnalyticsModule,
    BugReportsModule,
    EventRegistrationsModule,
    // docs/adr/0022-admin-control-center.md Decisions 4/6/7 — the admin
    // control center's read/triage surface (/api/v1/admin/*), entirely
    // behind ADR-0023 Part B's AdminAuthGuard. Decision 10's planning
    // endpoints and its step-up re-auth are not built.
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Moved here from main.ts's `app.useGlobalFilters(new
    // AppExceptionFilter())` by ADR-0022 Decision 6: same global scope, but
    // DI-provided so the filter can inject ErrorLogService. The e2e suite
    // still registers its own hand-constructed instance; Nest invokes only
    // the first matching filter, so the envelope is identical either way.
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
  ],
})
export class AppModule {}
