// docs/adr/0037-in-app-improvement-suggestions.md — every tunable number
// this feature has, in one place, following the layout
// bug-reports.constants.ts already established. Only the retention cutoff
// has a matching env var: the width below is the column's own (changing it
// in config alone would start failing inserts at the database), and the
// rate-limit pair is a product decision argued in ADR-0037 rather than
// something an operator tunes per environment.

/**
 * `ImprovementSuggestion.body` is `varchar(500)`, the same ceiling
 * `BugReport.description` uses — and for the same reason: the mobile
 * textarea *caps* the input rather than accepting it and refusing it
 * afterwards, so a child never types past the limit and then loses the
 * text. The `too-long` error path exists only for a stale client.
 *
 * Deliberately the same number as the bug-report cap rather than a larger
 * one. A suggestion is a prompt for a conversation the operator then has
 * with themselves in the backlog, not a specification; 500 characters is
 * already several times what a nine-year-old writes unprompted.
 */
export const IMPROVEMENT_SUGGESTION_BODY_MAX_LENGTH = 500;

/**
 * `app_version` is as attacker-controllable as the body itself (any
 * authenticated client can put arbitrary text in it), so it gets the same
 * boundary cap `BUG_REPORT_VERSION_STRING_MAX_LENGTH` applies for exactly
 * that reason. 64 is generous for "1.4.2" and far below anything that
 * could be a payload dump.
 */
export const IMPROVEMENT_SUGGESTION_VERSION_STRING_MAX_LENGTH = 64;

/**
 * How long a suggestion is kept before the daily sweep deletes it.
 * Overridable via IMPROVEMENT_SUGGESTION_RETENTION_DAYS.
 *
 * 90 days, matching `bug_report` and `error_log_entry`, and by **age
 * alone rather than status** for the reason
 * DEFAULT_BUG_REPORT_RETENTION_DAYS spells out: a retention promise that
 * any operator can defeat by not clicking anything is not a promise.
 *
 * This is worth stating plainly because the temptation here is stronger
 * than it was for bug reports — a good idea feels like something to keep.
 * It is: **in the backlog, in the operator's own words.** The row in this
 * table is a child's free text, and this table is not the roadmap. Acting
 * on a suggestion means writing it down somewhere that isn't
 * child-authored data; letting it sit here for a year is not "keeping"
 * it, it is only failing to delete it.
 */
export const DEFAULT_IMPROVEMENT_SUGGESTION_RETENTION_DAYS = 90;

/**
 * The weekly digest's cron expression — Monday 08:00 in the pod's
 * timezone. A fixed expression rather than an env var (unlike
 * USAGE_REPORT_CRON): the digest carries counts, not content, so there is
 * nothing an operator would want to re-time it around, and every knob
 * added here is one more thing that can be wrong in one cluster only.
 */
export const IMPROVEMENT_SUGGESTION_DIGEST_CRON = '0 8 * * 1';

/** The digest's own look-back window, matching its weekly cadence. */
export const IMPROVEMENT_SUGGESTION_DIGEST_WINDOW_DAYS = 7;
