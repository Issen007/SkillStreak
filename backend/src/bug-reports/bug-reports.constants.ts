// docs/adr/0022-admin-control-center.md Decision 7 — every tunable number
// this feature has, in one place. None of them is an env var: the first is
// the column's own width (changing it in config alone would start failing
// inserts at the database), and the rate-limit pair is a product decision
// argued below rather than something an operator tunes per environment.

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
