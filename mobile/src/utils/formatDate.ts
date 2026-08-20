import i18n from '../i18n';
import type { PlayerLocale } from '../api/types';

const MONTHS: Record<PlayerLocale, string[]> = {
  sv: [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december',
  ],
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  fi: [
    'tammikuuta', 'helmikuuta', 'maaliskuuta', 'huhtikuuta', 'toukokuuta', 'kesäkuuta',
    'heinäkuuta', 'elokuuta', 'syyskuuta', 'lokakuuta', 'marraskuuta', 'joulukuuta',
  ],
  da: [
    'januar', 'februar', 'marts', 'april', 'maj', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'december',
  ],
  nb: [
    'januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember',
  ],
  de: [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ],
  cs: [
    'ledna', 'února', 'března', 'dubna', 'května', 'června',
    'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
  ],
  fr: [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ],
  es: [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ],
};

/** Not every `i18n.language` value is guaranteed to be one of the 8
 * supported `PlayerLocale`s at the type level (react-i18next's own type is
 * a plain `string`) — falls back to `sv`, matching `fallbackLng` elsewhere. */
function currentLocale(): PlayerLocale {
  const lang = i18n.language;
  return (Object.prototype.hasOwnProperty.call(MONTHS, lang) ? lang : 'sv') as PlayerLocale;
}

/** `"2026-07-12"` -> `"12 juli"` (or the active locale's equivalent) — used
 * for goal end dates and `lastTrainedDate`, both shown as a plain date per
 * the flow doc's "no countdown/urgency styling" rule
 * (docs/design/phase2-flows.md). A manual per-locale month-name table
 * rather than `Intl.DateTimeFormat(...).format` — Hermes's bundled ICU data
 * doesn't reliably include full locale-aware month names, and this is
 * simple enough not to need it. Locale-aware since Phase 4.3 part (b) —
 * reads `i18n.language` rather than taking a param, so every existing call
 * site stays unchanged. */
export function formatSwedishDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [, monthStr, dayStr] = parts;
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day)) {
    return isoDate;
  }
  const locale = currentLocale();
  // English convention reads "July 12", not "12 July" — every other
  // supported language here follows the Swedish "day month" order.
  if (locale === 'en') return `${MONTHS.en[month - 1]} ${day}`;
  return `${day} ${MONTHS[locale][month - 1]}`;
}

/** Fas 4.2, Screen E6's grace-period date ("27 augusti 2026") — unlike
 * `formatSwedishDate` above (day+month only, fine for goal end dates/
 * `lastTrainedDate`, which are always read within the same year they're
 * shown), the 30-day erasure grace period can span a year boundary, so the
 * year is worth stating explicitly here. Accepts a full ISO timestamp (as
 * returned by `scheduledFor`), not just a date. Manual formatting, same
 * Hermes/ICU reasoning as the rest of this file; locale-aware the same way
 * as `formatSwedishDate` above. */
export function formatSwedishDateWithYear(isoDateTime: string): string {
  const isoDate = isoDateTime.slice(0, 10);
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDateTime;
  const [yearStr, monthStr, dayStr] = parts;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day)
  ) {
    return isoDateTime;
  }
  const locale = currentLocale();
  if (locale === 'en') return `${MONTHS.en[month - 1]} ${day}, ${year}`;
  return `${day} ${MONTHS[locale][month - 1]} ${year}`;
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

/** "just nu" / "för 2 timmar sedan" / "igår" — per-locale relative-time
 * phrasing with real plural agreement (not just a translated word swapped
 * into the Swedish sentence shape, which doesn't hold for every language's
 * grammar). Kept as hand-written phrase functions rather than routed
 * through i18next's own pluralization (which every other piece of UI copy
 * uses) since this file is a plain, framework-agnostic utility imported
 * from several feature areas' components — pulling `t()` in here would
 * mean either threading a translation function through every call site or
 * depending on a specific namespace, neither of which fits a shared,
 * cross-namespace helper as cleanly as this file's existing
 * locale-table pattern. */
const RELATIVE_TIME: Record<
  PlayerLocale,
  {
    justNow: string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    yesterday: string;
    daysAgo: (n: number) => string;
  }
> = {
  sv: {
    justNow: 'just nu',
    minutesAgo: (n) => `för ${n} minut${n === 1 ? '' : 'er'} sedan`,
    hoursAgo: (n) => `för ${n} timm${n === 1 ? 'e' : 'ar'} sedan`,
    yesterday: 'igår',
    daysAgo: (n) => `för ${n} dagar sedan`,
  },
  en: {
    justNow: 'just now',
    minutesAgo: (n) => `${n} minute${n === 1 ? '' : 's'} ago`,
    hoursAgo: (n) => `${n} hour${n === 1 ? '' : 's'} ago`,
    yesterday: 'yesterday',
    daysAgo: (n) => `${n} days ago`,
  },
  fi: {
    justNow: 'juuri nyt',
    minutesAgo: (n) => `${n} minuutti${n === 1 ? '' : 'a'} sitten`,
    hoursAgo: (n) => `${n} tunti${n === 1 ? '' : 'a'} sitten`,
    yesterday: 'eilen',
    daysAgo: (n) => `${n} päivää sitten`,
  },
  da: {
    justNow: 'lige nu',
    minutesAgo: (n) => `for ${n} minut${n === 1 ? '' : 'ter'} siden`,
    hoursAgo: (n) => `for ${n} time${n === 1 ? '' : 'r'} siden`,
    yesterday: 'i går',
    daysAgo: (n) => `for ${n} dage siden`,
  },
  nb: {
    justNow: 'akkurat nå',
    minutesAgo: (n) => `for ${n} minutt${n === 1 ? '' : 'er'} siden`,
    hoursAgo: (n) => `for ${n} time${n === 1 ? '' : 'r'} siden`,
    yesterday: 'i går',
    daysAgo: (n) => `for ${n} dager siden`,
  },
  de: {
    justNow: 'gerade eben',
    minutesAgo: (n) => `vor ${n} Minute${n === 1 ? '' : 'n'}`,
    hoursAgo: (n) => `vor ${n} Stunde${n === 1 ? '' : 'n'}`,
    yesterday: 'gestern',
    daysAgo: (n) => `vor ${n} Tagen`,
  },
  cs: {
    justNow: 'právě teď',
    // Code-critic finding, 2026-08-01: the instrumental plural
    // ("minutami"/"hodinami") is correct for n≥2 but wrong for n=1, which
    // needs the instrumental singular ("minutou"/"hodinou") — and n=1 is
    // the common case here (every clip/message passes through "1 minute
    // ago" on its way to older timestamps), not a rare exception. Fixed to
    // special-case n=1; n≥2 still uses one plural form (no further 2-4
    // vs. 5+ split modeled) — flagged for a native-speaker pass to confirm
    // that simplification reads naturally, not just grammatically valid.
    minutesAgo: (n) => (n === 1 ? 'před minutou' : `před ${n} minutami`),
    hoursAgo: (n) => (n === 1 ? 'před hodinou' : `před ${n} hodinami`),
    yesterday: 'včera',
    daysAgo: (n) => `před ${n} dny`,
  },
  fr: {
    justNow: "à l'instant",
    minutesAgo: (n) => `il y a ${n} minute${n === 1 ? '' : 's'}`,
    hoursAgo: (n) => `il y a ${n} heure${n === 1 ? '' : 's'}`,
    yesterday: 'hier',
    daysAgo: (n) => `il y a ${n} jours`,
  },
  // Spanish pluralises minuto/hora regularly, and "hace X" leads rather
  // than trails, so the shape differs from the Germanic locales above.
  es: {
    justNow: 'ahora mismo',
    minutesAgo: (n) => `hace ${n} minuto${n === 1 ? '' : 's'}`,
    hoursAgo: (n) => `hace ${n} hora${n === 1 ? '' : 's'}`,
    yesterday: 'ayer',
    daysAgo: (n) => `hace ${n} días`,
  },
};

/** Fas 3, Screen V2's clip timestamps — "för 2 timmar sedan"/"igår", no
 * exact clock time (per the flow doc: "no exact clock needed, this isn't a
 * conversation" — a deliberate difference from `formatChatTimestamp` above,
 * which does show clock time since chat replies are time-sensitive). Manual
 * arithmetic, same Hermes/ICU reasoning as the other helpers in this file.
 * Locale-aware since Phase 4.3 part (b) — see `RELATIVE_TIME` above. */
export function formatClipRelativeTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;

  const phrases = RELATIVE_TIME[currentLocale()];
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  if (diffMinutes < 1) return phrases.justNow;
  if (diffMinutes < 60) return phrases.minutesAgo(diffMinutes);

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return phrases.hoursAgo(diffHours);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 1) return phrases.yesterday;
  if (diffDays < 7) return phrases.daysAgo(diffDays);

  return formatSwedishDate(date.toISOString().slice(0, 10));
}
