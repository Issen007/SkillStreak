import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ErrorLogModule } from '../error-log/error-log.module';
import { RedisModule } from '../redis/redis.module';
import { BugReportRetentionService } from './bug-report-retention.service';
import { BugReportsController } from './bug-reports.controller';
import { BugReportsService } from './bug-reports.service';
import { BugReport } from './entities/bug-report.entity';

/**
 * docs/adr/0022-admin-control-center.md Decision 7 — the **player-facing**
 * half of bug reports: one authenticated `POST`, nothing else.
 *
 * The admin triage half (`GET`/`PATCH /api/v1/admin/bug-reports`) lives in
 * `admin/`, behind `AdminAuthGuard`, for the same reason ErrorLogModule
 * keeps its own read endpoint out: importing the module a player-facing
 * write lives in must never mean importing an admin-authenticated endpoint.
 * The entity is exported (via `TypeOrmModule`) so AdminModule can read it
 * without redeclaring it.
 *
 * `AuthModule` for `@UseGuards(JwtAuthGuard)`; `RedisModule` for the
 * per-player burst/daily rate limit and the retention sweep's cross-pod run
 * lock; `ErrorLogModule` so that sweep can record a run-level failure the
 * same way every other scheduled job does. No MailModule — nothing here
 * notifies anyone, by design (§9.5: the success screen makes no promise of a
 * reply, because there is no reply channel).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BugReport]),
    AuthModule,
    RedisModule,
    ErrorLogModule,
  ],
  controllers: [BugReportsController],
  providers: [BugReportsService, BugReportRetentionService],
  exports: [TypeOrmModule],
})
export class BugReportsModule {}
