import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import {
  ErrorLogEntry,
  ErrorLogSource,
} from '../error-log/entities/error-log-entry.entity';
import { ErrorLogService } from '../error-log/error-log.service';
import {
  DEFAULT_ERROR_LOG_PAGE_SIZE,
  ListErrorLogQueryDto,
} from './dto/list-error-log-query.dto';

/**
 * One row as the console renders it. This is the whole table — there is no
 * omitted column, because there is no column here that could resolve to a
 * child (ADR-0022 Decision 6: no `player_id`/`team_id` exists on
 * `error_log_entry` at all, and `route` is the route TEMPLATE, never the
 * resolved path that would carry a live consent/erasure token).
 *
 * docs/design/phase7-admin-console-flows.md §5.1 turns that into a UI rule
 * worth restating here: the console must not render a greyed-out "user"
 * column, because a greyed-out column implies the data exists and is merely
 * withheld — the opposite of true.
 */
export interface AdminErrorLogRow {
  id: string;
  occurredAt: string;
  source: ErrorLogSource;
  /** `null` on an unmatched HTTP request — §5.2 renders that as the literal
   * word `(unmatched)`, not an empty cell. */
  route: string | null;
  method: string | null;
  jobName: string | null;
  statusCode: number | null;
  errorName: string;
  message: string;
  stack: string | null;
}

export interface AdminErrorLogResponse {
  entries: AdminErrorLogRow[];
  /** Total matching the current filters, not the page — §5.2's "Showing
   * {n} of {total}". */
  total: number;
  limit: number;
  offset: number;
  /**
   * docs/design/phase7-admin-console-flows.md §13 — the two config values
   * the console needs to render its own copy honestly ("Kept {retentionDays}
   * days, then deleted", "Stack (first {maxFrames} frames, truncated on
   * write)"). Both are knobs, not fixed facts, so §2's standing copy rule
   * forbids printing a literal.
   *
   * **This response is their single home**, deliberately — they are not also
   * echoed on `GET /api/v1/admin/session`. They describe this endpoint's own
   * data, and two sources for one number is how the two drift.
   */
  retentionDays: number;
  stackMaxFrames: number;
}

/**
 * docs/adr/0022-admin-control-center.md Decision 6's read side. Kept out of
 * `error-log/` on purpose (see ErrorLogModule's docstring): every module
 * that records a failure imports that module, and importing it must never
 * mean importing an admin-authenticated endpoint.
 */
@Injectable()
export class AdminErrorLogService {
  constructor(
    @InjectRepository(ErrorLogEntry)
    private readonly errorLogRepository: Repository<ErrorLogEntry>,
    // For the two config accessors only — ErrorLogService is the single
    // reader of ERROR_LOG_RETENTION_DAYS/ERROR_LOG_STACK_MAX_FRAMES, so the
    // console is guaranteed to be told the same numbers the retention sweep
    // and the recorder actually use.
    private readonly errorLogService: ErrorLogService,
  ) {}

  async list(query: ListErrorLogQueryDto): Promise<AdminErrorLogResponse> {
    const limit = query.limit ?? DEFAULT_ERROR_LOG_PAGE_SIZE;
    const offset = query.offset ?? 0;

    const [entries, total] = await this.errorLogRepository.findAndCount({
      where: buildErrorLogWhere(query),
      // Fixed newest-first, no sort parameter — §5.3: the endpoint contract
      // defines no sort, so the console renders no sortable headers rather
      // than offering a control that would only re-sort the loaded page.
      order: { occurredAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      entries: entries.map(toAdminErrorLogRow),
      total,
      limit,
      offset,
      retentionDays: this.errorLogService.retentionDays(),
      stackMaxFrames: this.errorLogService.stackMaxFrames(),
    };
  }
}

function toAdminErrorLogRow(entry: ErrorLogEntry): AdminErrorLogRow {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    source: entry.source,
    route: entry.route,
    method: entry.method,
    jobName: entry.jobName,
    statusCode: entry.statusCode,
    errorName: entry.errorName,
    message: entry.message,
    stack: entry.stack,
  };
}

/**
 * Exported for its own unit test — the filter combinations (a range with
 * only one bound, "no status" vs. an explicit range, a date window with only
 * a `from`) are the part of this endpoint most likely to silently return the
 * wrong set, and they're pure enough to test without a database.
 */
export function buildErrorLogWhere(
  query: ListErrorLogQueryDto,
): FindOptionsWhere<ErrorLogEntry> {
  const where: FindOptionsWhere<ErrorLogEntry> = {};

  if (query.source) {
    where.source = query.source;
  }

  // `hasStatusCode: false` and an explicit range are mutually exclusive by
  // meaning (a NULL status_code is in no range), so nullness wins when both
  // are somehow sent — the operator asked for job rows, and returning an
  // empty set for a self-contradictory filter would look like a bug in the
  // console rather than in the request.
  if (query.hasStatusCode === false) {
    where.statusCode = IsNull();
  } else if (
    query.statusCodeMin !== undefined &&
    query.statusCodeMax !== undefined
  ) {
    where.statusCode = Between(query.statusCodeMin, query.statusCodeMax);
  } else if (query.statusCodeMin !== undefined) {
    where.statusCode = MoreThanOrEqual(query.statusCodeMin);
  } else if (query.statusCodeMax !== undefined) {
    where.statusCode = LessThanOrEqual(query.statusCodeMax);
  } else if (query.hasStatusCode === true) {
    where.statusCode = Not(IsNull());
  }

  if (query.from && query.to) {
    where.occurredAt = Between(new Date(query.from), new Date(query.to));
  } else if (query.from) {
    where.occurredAt = MoreThanOrEqual(new Date(query.from));
  } else if (query.to) {
    where.occurredAt = LessThanOrEqual(new Date(query.to));
  }

  return where;
}
