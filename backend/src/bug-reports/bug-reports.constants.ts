// docs/adr/0022-admin-control-center.md Decision 7 — every tunable number
// this feature has, in one place. Only the retention cutoff at the bottom
// has a matching env var: the width below is the column's own (changing it
// in config alone would start failing inserts at the database), and the
// rate-limit pair is a product decision argued below rather than something
// an operator tunes per environment.

/**
 * Decision 7's schema, verbatim: `description varchar(500), nullable`. Also
 * the mobile textarea's hard cap (docs/design/phase7-admin-console-flows.md
 * §9.2 — the input is *capped*, not validated-then-rejected, so §9.4's
 * `too-long` state is unreachable from the real UI and exists only for a
 * stale client).
 */
export const BUG_REPORT_DESCRIPTION_MAX_LENGTH = 500;

/**
 * `app_version`/`os_version` are `varchar` with no width in Decision 7's
 * schema, but they are just as attacker-controllable as `description` (the
 * 2026-08-02 security-reviewer correction's whole point: any authenticated
 * client can put arbitrary text in either). An unbounded column plus an
 * unbounded DTO would let one authenticated account write megabytes per
 * report into a table the admin console paginates over — so both get a
 * boundary cap here. 64 is generous for "1.4.2" / "iOS 17.5.1" and far
 * below anything that could be a payload dump.
 */
export const BUG_REPORT_VERSION_STRING_MAX_LENGTH = 64;

/**
 * How long a bug report is kept before the daily sweep deletes it.
 * Overridable via BUG_REPORT_RETENTION_DAYS.
 *
 * Added 2026-08-09, from a security-reviewer observation: `bug_report` was
 * the one table in this app holding **child-authored free text** with no
 * retention bound at all, while clips (ADR-0010) and `error_log_entry`
 * (Decision 6) both have one. Erasure cascades already remove a departing
 * player's reports, but a report from a player who stays was kept forever —
 * which is not the retention posture this app promises everywhere else.
 *
 * **Deliberately by age alone, not by status.** Sweeping only `closed`
 * reports would let an untouched `open` one live indefinitely, which is
 * exactly the outcome a retention rule exists to prevent — a privacy
 * promise that any operator can defeat by not clicking anything is not a
 * promise. 90 days (matching the error log, and ADR-0010's clip window) is
 * far longer than any real triage window, so the trade is theoretical in
 * practice; where it isn't, the fix is to act on the report, not to keep it.
 */
export const DEFAULT_BUG_REPORT_RETENTION_DAYS = 90;
