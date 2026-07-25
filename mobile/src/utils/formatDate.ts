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

/** Fas 2.6b, Screen CH1's message timestamps — "clock time only for
 * today's messages, date + time if older" per the flow doc. Manual
 * formatting (not `Intl.DateTimeFormat`), same Hermes/ICU reasoning as
 * `formatSwedishDate` above. */
export function formatChatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const clockTime = `${hours}:${minutes}`;

  if (isToday) return clockTime;

  const isoDate = date.toISOString().slice(0, 10);
  return `${formatSwedishDate(isoDate)} ${clockTime}`;
}

/** Fas 3, Screen V2's clip timestamps — "för 2 timmar sedan"/"igår", no
 * exact clock time (per the flow doc: "no exact clock needed, this isn't a
 * conversation" — a deliberate difference from `formatChatTimestamp` above,
 * which does show clock time since chat replies are time-sensitive). Manual
 * arithmetic, same Hermes/ICU reasoning as the other helpers in this file. */
export function formatClipRelativeTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  if (diffMinutes < 1) return 'just nu';
  if (diffMinutes < 60) return `för ${diffMinutes} minut${diffMinutes === 1 ? '' : 'er'} sedan`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `för ${diffHours} timm${diffHours === 1 ? 'e' : 'ar'} sedan`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 1) return 'igår';
  if (diffDays < 7) return `för ${diffDays} dagar sedan`;

  return formatSwedishDate(date.toISOString().slice(0, 10));
}
