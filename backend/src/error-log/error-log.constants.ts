// docs/adr/0022-admin-control-center.md Decision 6 — every tunable number
// and every stable string this pipeline has, in one place. The two values
// with a matching env var say so in their own comment; the rest are
// code-level constants because changing them changes what the schema itself
// guarantees (the 500-char message ceiling is the column's own width) or is
// a pure safety backstop.

/**
 * `ErrorLogEntry.message` is `varchar(500)` (Decision 6's schema, verbatim),
 * so this is the column width, not a policy knob — deliberately NOT an env
 * var: raising it in config alone would start failing inserts at the
 * database, and the whole point of this service is that recording an error
 * can never itself become an error.
 */
export const ERROR_LOG_MESSAGE_MAX_LENGTH = 500;

/**
 * Decision 6's "truncated (e.g. first ~20 frames)" — explicitly a
 * recommendation rather than a fixed number, which is why the admin console
 * interpolates it from config instead of printing a literal (see
 * docs/design/phase7-admin-console-flows.md §5.2/§13). Overridable via
 * ERROR_LOG_STACK_MAX_FRAMES.
 */
export const DEFAULT_ERROR_LOG_STACK_MAX_FRAMES = 20;

/**
 * Decision 6's retention sweep cutoff ("recommend 90 days") — same
 * "bounded table growth, no legitimate reason to keep low-value operational
 * debugging data indefinitely" posture as ADR-0010's clip retention window,
 * and the same shape of knob (CLIP_RETENTION_DAYS). Overridable via
 * ERROR_LOG_RETENTION_DAYS.
 */
export const DEFAULT_ERROR_LOG_RETENTION_DAYS = 90;

/**
 * A pure backstop for stacks that don't look like V8's
 * `Header\n    at frame` shape at all (a rethrown string, an error from a
 * library that overwrites `.stack`, a bundled/minified single-line trace).
 * The frame-count truncation below can't bound those, and `stack` is an
 * unbounded `text` column — so one pathological error would otherwise be
 * able to write megabytes per occurrence into a table the admin console
 * paginates over. Not a substitute for the frame limit: the frame limit is
 * what Decision 6 actually specifies and what applies to every normal error.
 */
export const ERROR_LOG_STACK_MAX_CHARS = 8_000;

/**
 * Job names recorded in `ErrorLogEntry.job_name`. Deliberately the SAME
 * strings the existing `@Cron` handlers already pass to
 * RedisService.tryClaimScheduledJobRun as their cross-pod run-lock keys —
 * one vocabulary for "which scheduled job is this", so a row in the admin
 * console's error list and a stuck Redis run-lock key name the same thing.
 */
export const ERROR_LOG_JOB_NAMES = {
  clipRetentionPublished: 'clip-retention:published',
  clipRetentionPendingUpload: 'clip-retention:pending-upload',
  accountErasureSweep: 'account-erasure:sweep',
  usageMetricsReport: 'usage-metrics:report',
  errorLogRetention: 'error-log:retention',
  bugReportRetention: 'bug-report:retention',
  /** ADR-0028 Decision 7's 365-day sweep for generated training plans. */
  trainingPlanRetention: 'training-plan:retention',
  eventRegistrationRetention: 'event-registration:retention',
} as const;
