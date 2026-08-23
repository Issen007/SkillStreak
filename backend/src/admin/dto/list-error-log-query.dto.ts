import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ErrorLogSource } from '../../error-log/entities/error-log-entry.entity';

export const DEFAULT_ERROR_LOG_PAGE_SIZE = 50;
export const MAX_ERROR_LOG_PAGE_SIZE = 200;

/**
 * docs/adr/0022-admin-control-center.md Decision 6 — "paginated, filterable
 * by `source`/`status_code` range/date, never by anything that could resolve
 * to a child, because nothing in this table can."
 *
 * Every filter here maps onto a column that exists on `error_log_entry`, and
 * that table has no `player_id`/`team_id` column at all — so the absence of
 * a player/team filter isn't a restraint this DTO is exercising, it's a
 * consequence of the schema. `main.ts`'s global `ValidationPipe`
 * (`whitelist: true, forbidNonWhitelisted: true`) rejects any parameter not
 * listed here outright rather than ignoring it.
 *
 * How docs/design/phase7-admin-console-flows.md §5.3's four Status chips map
 * onto this DTO, since the design names classes and the ADR specifies a
 * range: `2xx` → `statusCodeMin=200&statusCodeMax=299` (and so on), and
 * `No status` → `hasStatusCode=false`, which is `status_code IS NULL` — job
 * rows and, since 2026-08-23, `client` rows too, neither of which answers
 * an HTTP request. Filter on `source` to separate them. Ranges rather than
 * exact codes, per the ADR.
 */
export class ListErrorLogQueryDto {
  @IsOptional()
  @IsEnum(ErrorLogSource)
  source?: ErrorLogSource;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCodeMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCodeMax?: number;

  /**
   * `false` selects rows with a NULL `status_code` (the console's "No
   * status" chip — job rows); `true` selects rows that have one. Omitted
   * means "don't filter on nullness at all".
   *
   * Explicitly transformed from the literal strings, not left to
   * class-transformer's implicit coercion: a query string carries `'false'`,
   * which is a truthy JavaScript string, and silently reading it as `true`
   * would invert the operator's filter.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  hasStatusCode?: boolean;

  /** Inclusive lower bound on `occurred_at`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Inclusive upper bound on `occurred_at`. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ERROR_LOG_PAGE_SIZE)
  limit?: number;

  /**
   * Offset, not a cursor, deliberately: §5.2's footer is "Showing 50 of 231"
   * with Newer/Older buttons, which needs a total count anyway, and this
   * table is bounded by Decision 6's retention sweep. A single operator
   * paging through an operational log is not the high-volume, drifting-feed
   * case the clip/chat cursors exist for.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
