import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsageMetricsService } from '../usage-metrics/usage-metrics.service';
import { AdminAuthGuard } from '../staff-auth/guards/admin-auth.guard';
import { AdminStepUpGuard } from '../staff-auth/guards/admin-step-up.guard';
// Imported from `pt/` rather than duplicated: it's a pure param decorator
// over `request.staffAccountId` (set by StaffAuthGuard, which both
// AdminAuthGuard and PtAuthGuard build on), with no DI and no PT-specific
// behaviour — it just happened to be written first for the PT surface. A
// second copy would be two things to keep in sync for zero benefit.
import { CurrentStaffAccountId } from '../pt/current-staff-account-id.decorator';
import {
  AdminBugReportRow,
  AdminBugReportsResponse,
  AdminBugReportsService,
} from './admin-bug-reports.service';
import {
  AdminErrorLogResponse,
  AdminErrorLogService,
} from './admin-error-log.service';
import {
  AdminSessionResponse,
  AdminSessionService,
} from './admin-session.service';
import { AdminPlanningDocsService } from './admin-planning-docs.service';
import {
  AdminPlanningResponse,
  toPlanningResponse,
} from './admin-planning.view';
import {
  AdminUsageMetricsResponse,
  toAdminUsageMetricsResponse,
} from './admin-usage-metrics.view';
import {
  DEFAULT_BUG_REPORT_PAGE_SIZE,
  ListBugReportsQueryDto,
} from './dto/list-bug-reports-query.dto';
import { EmptyQueryDto } from './dto/empty-query.dto';
import { ListErrorLogQueryDto } from './dto/list-error-log-query.dto';
import { UpdateBugReportStatusDto } from './dto/update-bug-report-status.dto';

/**
 * docs/adr/0022-admin-control-center.md Decisions 4, 6 and 7 — the admin
 * control center's JSON surface, on the existing `api` Deployment/Service/
 * HTTPRoute (Decision 3, reaffirmed unconditionally by that ADR's
 * 2026-08-05 amendment: these four pillars stay on `api` permanently, not
 * provisionally). Zero new Kubernetes primitives.
 *
 * **Authentication is `AdminAuthGuard`, class-level, no exceptions.**
 * Decision 2's single password/`ADMIN_JWT_SECRET` credential is
 * **superseded** by docs/adr/0023-pt-role-and-staff-sso-rbac.md Part B —
 * there is no admin password, no `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`, and
 * no bcrypt anywhere in this app. `AdminAuthGuard` verifies the
 * `staff_session` cookie and then does a real per-request `StaffAccount`
 * lookup (revoked_at + a live `ADMIN_EMAILS` re-check), so an admin's
 * authority is re-derived on every call rather than trusted from a claim.
 *
 * Decision 10's `planning/*` endpoints were added 2026-08-08, once the
 * step-up question that blocked them was resolved in favour of OIDC
 * re-authentication (see StaffAuthService.buildLoginRedirect). They carry
 * AdminStepUpGuard *in addition to* the class-level AdminAuthGuard: Nest
 * runs both, and AdminStepUpGuard itself also composes AdminAuthGuard, so
 * that guard executes twice on those three routes. Harmless — strictly
 * more gating, one extra row lookup on a low-volume operator surface — and
 * stated plainly here because an earlier version of this comment said
 * "instead of", which would mislead the next reader of exactly this code.
 *
 * **The admin web page is served from main.ts, not here** (added
 * 2026-08-10) — `backend/console/` is mounted read-only at /console by
 * `useStaticAssets`. The constraint this docstring used to state as a
 * warning is satisfied rather than pending: that directory holds only the
 * console's own files and is disjoint from the `admin-planning-docs`
 * mount, whose contents are readable only through this guard plus step-up.
 * See AdminPlanningDocsService's docstring for why that separation is
 * structural, and keep it that way if the console ever moves.
 */
@Controller('api/v1/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly adminSessionService: AdminSessionService,
    private readonly usageMetricsService: UsageMetricsService,
    private readonly adminErrorLogService: AdminErrorLogService,
    private readonly adminBugReportsService: AdminBugReportsService,
    private readonly adminPlanningDocsService: AdminPlanningDocsService,
  ) {}

  // §13/§2 — lets the console know it's signed in on first paint without
  // firing a data request and interpreting a 401, and gives it the
  // environment value the PRODUCTION/INTERNAL TEST badge needs.
  @Get('session')
  getSession(
    @CurrentStaffAccountId() staffAccountId: string,
  ): Promise<AdminSessionResponse> {
    return this.adminSessionService.describe(staffAccountId);
  }

  /**
   * Decision 4 — calls the **same** `UsageMetricsService` the monthly email
   * job calls, synchronously, per request. No duplicated query logic and no
   * second way to compute the same number; that is the Decision's central
   * requirement, not an implementation preference.
   *
   * **No query parameters at all.** Decision 5: the endpoint accepts nothing
   * that identifies a team or player. Note the mechanism, corrected
   * 2026-08-08: declaring no `@Query()` means ValidationPipe never runs on
   * the query string, so an unlisted parameter is *ignored*, not rejected —
   * `forbidNonWhitelisted` has nothing to validate against. Harmless here
   * (this handler reads no input at all, so an ignored parameter cannot
   * change what it returns), but the planning routes below take an
   * EmptyQueryDto to make the guarantee real rather than assumed. The
   * response mapper additionally drops `totalTeams` — see
   * admin-usage-metrics.view.ts.
   *
   * Recomputed fresh on every call (Decision 4: no snapshot table). It's
   * eight aggregate queries against the shared pool, run by one operator at
   * human frequency.
   */
  @Get('usage-metrics')
  async getUsageMetrics(): Promise<AdminUsageMetricsResponse> {
    const report = await this.usageMetricsService.collect();
    return toAdminUsageMetricsResponse(report);
  }

  // Decision 6 — paginated, filterable by source / status_code range /
  // date. Never filterable by anything that could resolve to a child,
  // because `error_log_entry` has no such column.
  @Get('errors')
  getErrors(
    @Query() query: ListErrorLogQueryDto,
  ): Promise<AdminErrorLogResponse> {
    return this.adminErrorLogService.list(query);
  }

  // Decision 7's triage queue. Returns screen name + team name and nothing
  // else about the reporter — never real_name, never parent_contact (§6.3).
  @Get('bug-reports')
  getBugReports(
    @Query() query: ListBugReportsQueryDto,
  ): Promise<AdminBugReportsResponse> {
    return this.adminBugReportsService.list({
      status: query.status,
      limit: query.limit ?? DEFAULT_BUG_REPORT_PAGE_SIZE,
      offset: query.offset ?? 0,
    });
  }

  /**
   * Status only, any target status (§6.4 — not forward-only). 404 when the
   * report is gone, which is a real case rather than a defensive one:
   * `bug_report.player_id` is ON DELETE CASCADE, so an account erasure
   * removes a report the operator may still have open.
   *
   * `ParseUUIDPipe` because this is boundary input: without it a malformed
   * id reaches Postgres as an invalid uuid cast and surfaces as a 500
   * instead of the 400 it is.
   */
  @Patch('bug-reports/:id')
  updateBugReportStatus(
    @Param('id', ParseUUIDPipe) bugReportId: string,
    @Body() dto: UpdateBugReportStatusDto,
  ): Promise<AdminBugReportRow> {
    return this.adminBugReportsService.updateStatus(bugReportId, dto.status);
  }

  /**
   * Decision 10's three planning views. All read-only, all take **no query
   * parameter of any kind**, and none returns anything shaped like a
   * per-player or per-team record — this pillar is the project's own
   * internal prose, and must never become a second path into Decision 5's
   * suppression floor.
   *
   * `/roadmap` returns its two halves already grouped and source-labelled
   * (§13): both come from the same ConfigMap at the same trust level since
   * the ADR's 2026-08-07 amendment, so the split is purely presentational
   * — but the console must not have to re-derive it, and must never
   * re-parse checkbox syntax client-side.
   */
  @Get('planning/roadmap')
  @UseGuards(AdminStepUpGuard)
  async getPlanningRoadmap(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- present purely so ValidationPipe runs on the query string at all; see EmptyQueryDto
    @Query() _query: EmptyQueryDto,
  ): Promise<AdminPlanningResponse> {
    const [plan, project] = await Promise.all([
      this.adminPlanningDocsService.read('roadmapPlan'),
      this.adminPlanningDocsService.read('roadmapProject'),
    ]);
    return toPlanningResponse([plan, project]);
  }

  @Get('planning/ideas')
  @UseGuards(AdminStepUpGuard)
  async getPlanningIdeas(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see getPlanningRoadmap
    @Query() _query: EmptyQueryDto,
  ): Promise<AdminPlanningResponse> {
    return toPlanningResponse([
      await this.adminPlanningDocsService.read('ideas'),
    ]);
  }

  @Get('planning/security-issues')
  @UseGuards(AdminStepUpGuard)
  async getPlanningSecurityIssues(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see getPlanningRoadmap
    @Query() _query: EmptyQueryDto,
  ): Promise<AdminPlanningResponse> {
    return toPlanningResponse([
      await this.adminPlanningDocsService.read('securityIssues'),
    ]);
  }
}
