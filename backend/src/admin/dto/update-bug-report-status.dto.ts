import { IsEnum } from 'class-validator';
import { BugReportStatus } from '../../bug-reports/entities/bug-report.entity';

/**
 * docs/adr/0022-admin-control-center.md Decision 7 — "updates `status` only
 * — no freeform admin-notes field in v1". That's why this DTO has exactly
 * one field: `forbidNonWhitelisted: true` means a client sending a `note`
 * gets a 400 rather than having it quietly dropped, so the absence of a
 * notes field is enforced at the boundary, not just unimplemented.
 *
 * **Any target status is accepted — transitions are not forward-only**
 * (docs/design/phase7-admin-console-flows.md §6.4, confirmed in §13). One
 * operator, no audit trail, and a mis-clicked "Closed" that couldn't be
 * undone from the UI would send them to `psql` — the exact thing this
 * console exists to replace. The UI therefore renders all three segments
 * enabled rather than disabling earlier ones.
 */
export class UpdateBugReportStatusDto {
  @IsEnum(BugReportStatus)
  status!: BugReportStatus;
}
