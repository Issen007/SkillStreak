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
import {
  AdminUsageMetricsResponse,
  toAdminUsageMetricsResponse,
} from './admin-usage-metrics.view';
import {
  DEFAULT_BUG_REPORT_PAGE_SIZE,
  ListBugReportsQueryDto,
} from './dto/list-bug-reports-query.dto';
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
 * **Not built here, deliberately** (out of scope for this pass, and in one
 * case still unresolved in the ADR itself): the `planning/*` endpoints and
 * their `admin-planning-docs` ConfigMap, Decision 10's step-up
 * re-authentication (whose TOTP-vs-password question the security-reviewer
 * pass left open and which blocks exactly those three endpoints), and any
 * static serving of an admin web page.
 */
@Controller('api/v1/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly adminSessionService: AdminSessionService,
    private readonly usageMetricsService: UsageMetricsService,
    private readonly adminErrorLogService: AdminErrorLogService,
    private readonly adminBugReportsService: AdminBugReportsService,
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
   * that identifies a team or player, and `main.ts`'s
   * `forbidNonWhitelisted: true` rejects any unlisted parameter outright
   * rather than ignoring it. The response mapper additionally drops
   * `totalTeams` — see admin-usage-metrics.view.ts.
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
}
