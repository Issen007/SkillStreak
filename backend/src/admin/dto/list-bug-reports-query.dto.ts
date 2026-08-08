import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BugReportStatus } from '../../bug-reports/entities/bug-report.entity';

export const DEFAULT_BUG_REPORT_PAGE_SIZE = 50;
export const MAX_BUG_REPORT_PAGE_SIZE = 200;

/**
 * docs/adr/0022-admin-control-center.md Decision 7 — "paginated, filter by
 * `status`". That is the entire filter set, and it is deliberately the
 * entire filter set: docs/design/phase7-admin-console-flows.md §6.3
 * requires **no filter, sort, or search by reporter**, so there is no
 * player/team/screen-name parameter here for a UI control to bind to. With
 * `main.ts`'s `forbidNonWhitelisted: true`, adding one would have to be an
 * explicit, reviewable change to this file.
 */
export class ListBugReportsQueryDto {
  /** Omitted = the console's "All" chip. */
  @IsOptional()
  @IsEnum(BugReportStatus)
  status?: BugReportStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_BUG_REPORT_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
