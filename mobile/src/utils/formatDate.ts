const SWEDISH_MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];

/** `"2026-07-12"` -> `"12 juli"` — used for goal end dates and
 * `lastTrainedDate`, both shown as a plain date per the flow doc's "no
 * countdown/urgency styling" rule (docs/design/phase2-flows.md). A manual
 * month-name table rather than `Intl.DateTimeFormat(...).format` — Hermes's
 * bundled ICU data doesn't reliably include full locale-aware month names,
 * and this is simple enough not to need it. */
export function formatSwedishDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [, monthStr, dayStr] = parts;
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day)) {
    return isoDate;
  }
  return `${day} ${SWEDISH_MONTHS[month - 1]}`;
}
