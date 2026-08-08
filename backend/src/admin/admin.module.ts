import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BugReportsModule } from '../bug-reports/bug-reports.module';
import { ErrorLogModule } from '../error-log/error-log.module';
import { Player } from '../players/entities/player.entity';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { Team } from '../teams/entities/team.entity';
import { UsageMetricsModule } from '../usage-metrics/usage-metrics.module';
import { AdminBugReportsService } from './admin-bug-reports.service';
import { AdminController } from './admin.controller';
import { AdminErrorLogService } from './admin-error-log.service';
import { AdminPlanningDocsService } from './admin-planning-docs.service';
import { AdminSessionService } from './admin-session.service';

/**
 * docs/adr/0022-admin-control-center.md Decisions 4/6/7 — the admin control
 * center's read/triage surface, all of it behind `AdminAuthGuard`.
 *
 * **The import list is the point of this module.** Each of the three data
 * pillars is consumed from the module that already owns it, rather than
 * reimplemented here:
 *
 * - `UsageMetricsModule` exports `UsageMetricsService`, so the web view and
 *   the monthly email job compute the eight metrics through the *same*
 *   methods (Decision 4's central requirement: "no duplicated query logic,
 *   no second way to compute the same number").
 * - `ErrorLogModule` exports `ErrorLogService` (for the retention/frame-count
 *   config the console interpolates) and the `ErrorLogEntry` repository.
 * - `BugReportsModule` exports the `BugReport` repository; the player-facing
 *   `POST` stays over there, behind `JwtAuthGuard`.
 * - `StaffAuthModule` re-exports `AdminAuthGuard` and the `StaffAccount`
 *   repository the guard and the session endpoint both need.
 *
 * `Player`/`Team` are registered directly with `TypeOrmModule.forFeature`
 * (the same technique UsageMetricsModule and AccountErasureModule already
 * use for entities they only read) rather than by importing
 * PlayersModule/TeamsModule: the bug-report queue needs exactly three player
 * columns and one team column for the reporter block, and has no business
 * pulling in those modules' services.
 *
 * Deliberately **not** registered or imported: `PlayerPrivateInfo` /
 * `PlayerPrivateInfoModule`. The queue shows a reporter's screen name and
 * team name and must never show `real_name`/`parent_contact` (§6.3) — the
 * cheapest way to guarantee that is for this module to have no way to read
 * that table at all, the same technique UsageMetricsModule already uses for
 * the same table.
 *
 * Nothing is exported: nothing else in this app has any business calling an
 * admin-authenticated surface.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Player, Team]),
    StaffAuthModule,
    UsageMetricsModule,
    ErrorLogModule,
    BugReportsModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminSessionService,
    AdminErrorLogService,
    AdminBugReportsService,
    AdminPlanningDocsService,
  ],
})
export class AdminModule {}
