// Server-side "what day is it" helpers, fixed to Europe/Stockholm per
// docs/api/phase1-contract.md: streak/day-boundary logic must never trust a
// client-supplied clock or timezone. All dates are represented as plain
// 'YYYY-MM-DD' strings (calendar days), which sidesteps DST edge cases for
// the arithmetic below because we never do instant/duration math on them.

const STOCKHOLM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns the current calendar date in Europe/Stockholm as 'YYYY-MM-DD'.
 * `now` is only a seam for tests — production code should call this with no
 * argument so it reflects the real server clock.
 */
export function stockholmDateString(now: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD directly.
  return STOCKHOLM_DATE_FORMATTER.format(now);
}

/**
 * Given a 'YYYY-MM-DD' calendar date, returns the previous calendar day as
 * 'YYYY-MM-DD'. Pure date arithmetic (via UTC-midnight representations of
 * the calendar date) — not a timezone conversion, so it's safe to use on
 * values already produced by `stockholmDateString`.
 */
export function previousDateString(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const asUtcMidnight = new Date(Date.UTC(year, month - 1, day));
  asUtcMidnight.setUTCDate(asUtcMidnight.getUTCDate() - 1);
  return asUtcMidnight.toISOString().slice(0, 10);
}
