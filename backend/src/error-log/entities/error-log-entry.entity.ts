import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ERROR_LOG_MESSAGE_MAX_LENGTH } from '../error-log.constants';

// docs/adr/0022-admin-control-center.md Decision 6 — the two kinds of
// failure this table can hold. An `http` row carries route/method/
// status_code and never job_name; a `job` row carries job_name and never
// the other three (the admin console's Source filter greys out the Status
// control for exactly this reason — see
// docs/design/phase7-admin-console-flows.md §5.3).
export enum ErrorLogSource {
  HTTP = 'http',
  JOB = 'job',
}

/**
 * docs/adr/0022-admin-control-center.md Decision 6 — durable, queryable
 * application-error/failed-job visibility, self-hosted in the stack this
 * app already runs (no Sentry SaaS sub-processor, no self-hosted
 * Clickhouse/Kafka cluster — see that Decision's own three-option
 * comparison).
 *
 * **This table deliberately has no `player_id`/`team_id` column at all**,
 * and adding one is a structural change to Decision 6, not a schema tweak:
 * the table is about the *system*, never about an identifiable child, by
 * construction rather than by policy. That exclusion is also what makes it
 * erasure-exempt — it references no `Player`, so
 * docs/adr/0013-account-erasure.md's per-entity table needs no row for it,
 * there being nothing to anonymize or cascade.
 *
 * The redaction allow-list is enforced by what columns exist here plus
 * ErrorLogService's own construction of them — never the resolved request
 * path (several live routes carry a working consent/erasure token as a path
 * parameter), never the body, never the query string, never headers. If a
 * specific error's context is genuinely needed beyond route/method/status,
 * Decision 6 requires it be added as an explicit, named, reviewed column
 * here — never a generic "attach the request" fallback.
 */
@Entity('error_log_entry')
// The admin list query (GET /api/v1/admin/errors, built separately) is
// always "newest first, optionally filtered by source/status/date range".
// Postgres scans a btree backwards happily, so a plain ASC index serves the
// DESC ordering — no DESC index needed, and keeping the entity metadata and
// the migration identical avoids spurious `migration:generate` diffs.
@Index('IDX_error_log_entry_occurred_at', ['occurredAt'])
@Index('IDX_error_log_entry_source_occurred_at', ['source', 'occurredAt'])
export class ErrorLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Set explicitly by ErrorLogService (not a @CreateDateColumn): this is
  // when the error *happened*, which is what the console sorts and filters
  // on, and the recording insert is fire-and-forget — its own timing is not
  // the event's timing.
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({
    type: 'enum',
    enum: ErrorLogSource,
    enumName: 'error_log_entry_source_enum',
  })
  source!: ErrorLogSource;

  // HTTP source only. The Express ROUTE TEMPLATE (e.g.
  // "/api/v1/consent/:token"), never the resolved literal path — see
  // ErrorLogService/routeTemplateOf. NULL both for job rows and for an
  // HTTP request that matched no route at all (an ordinary 404 from
  // internet background noise), which is why it must stay nullable.
  @Column({ type: 'varchar', nullable: true })
  route!: string | null;

  @Column({ type: 'varchar', nullable: true })
  method!: string | null;

  // Job source only — one of ERROR_LOG_JOB_NAMES.
  @Column({ name: 'job_name', type: 'varchar', nullable: true })
  jobName!: string | null;

  // HTTP source only. Always NULL for job rows (the console's "No status"
  // filter is exactly this).
  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode!: number | null;

  // The exception class name — 'AppException', 'NotFoundException',
  // 'TypeError', 'QueryFailedError'. Decision 6's schema has no column for
  // AppException's own `code`, deliberately: message/route/status_code carry
  // that signal, and widening this table is a reviewed change, not a
  // convenience.
  @Column({ name: 'error_name', type: 'varchar' })
  errorName!: string;

  // Truncated to this length on write (ERROR_LOG_MESSAGE_MAX_LENGTH).
  // Decision 6's standing convention — enforced by code review, not by a
  // runtime scrubber — is that no exception message may interpolate
  // PlayerPrivateInfo-scoped values (real_name, parent_contact) or freeform
  // user content (a chat message, a bug-report description) into its own
  // text. Player/team UUIDs are fine; they carry no human-readable identity.
  @Column({ type: 'varchar', length: ERROR_LOG_MESSAGE_MAX_LENGTH })
  message!: string;

  // Truncated to the first N frames on write (ERROR_LOG_STACK_MAX_FRAMES).
  // Nullable: a non-Error throw (a bare string, a rejected non-Error) has
  // no stack at all.
  @Column({ type: 'text', nullable: true })
  stack!: string | null;
}
