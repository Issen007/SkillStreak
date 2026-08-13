/**
 * ADR-0028 Decision 7's recommendation, adopted as-is.
 *
 * 365 days, deliberately far longer than the aggressive windows elsewhere
 * in this app — a generated session is **an adult's own work product**
 * about an age band, not child data, so the analogues here are the coach's
 * own notes rather than a clip or a bug report. A coach who liked a
 * session in September should still have it in March.
 *
 * Unlike `bug_report`, nothing here is child-authored, which is why this
 * number is the one place in the retention story that goes up rather than
 * down.
 */
export const DEFAULT_TRAINING_PLAN_RETENTION_DAYS = 365;
