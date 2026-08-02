import i18n from '../i18n';
import type { PlayerLocale } from '../api/types';

/** Not every `i18n.language` value is guaranteed to be one of the 8
 * supported `PlayerLocale`s at the type level (react-i18next's own type is
 * a plain `string`) — falls back to `sv`, matching `fallbackLng` elsewhere. */
function currentLocale(): PlayerLocale {
  const lang = i18n.language;
  const known: PlayerLocale[] = ['sv', 'en', 'fi', 'da', 'nb', 'de', 'cs', 'fr'];
  return (known as string[]).includes(lang) ? (lang as PlayerLocale) : 'sv';
}

function swedishOrdinalSuffix(rank: number): string {
  const lastTwoDigits = rank % 100;
  const lastDigit = rank % 10;
  // 11-13 are always "e", overriding the last-digit rule below (matches
  // real Swedish usage: "11:e", not "11:a").
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${rank}:e`;
  if (lastDigit === 1 || lastDigit === 2) return `${rank}:a`;
  return `${rank}:e`;
}

function englishOrdinalSuffix(rank: number): string {
  const lastTwoDigits = rank % 100;
  const lastDigit = rank % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${rank}th`;
  if (lastDigit === 1) return `${rank}st`;
  if (lastDigit === 2) return `${rank}nd`;
  if (lastDigit === 3) return `${rank}rd`;
  return `${rank}th`;
}

function frenchOrdinalSuffix(rank: number): string {
  // "1er" (premier), "2e"/"3e"/... onward — no further irregularity past 1.
  return rank === 1 ? '1er' : `${rank}e`;
}

/** Ordinal-suffix rule for VM-Guld-tabellen ranks (Fas 2.7, Screen LB1/LB2;
 * originally `swedishOrdinal`, generalized in Phase 4.3 part (b)) — a
 * genuine grammar rule per language, not a fixed suffix, per
 * docs/design/phase2.6-2.7-flows.md's explicit i18n flag. `fi`/`da`/`nb`/
 * `de`/`cs` all use the same "number + period" convention for written
 * ordinals (no suffix letters) — confirmed against each language's own
 * standard numeral-ordinal convention, not assumed from Swedish. Reads
 * `i18n.language` rather than taking a locale param, so every existing
 * call site (`TeamPoolCard`, `LeaderboardScreen`, etc.) stays unchanged. */
export function swedishOrdinal(rank: number): string {
  switch (currentLocale()) {
    case 'sv':
      return swedishOrdinalSuffix(rank);
    case 'en':
      return englishOrdinalSuffix(rank);
    case 'fr':
      return frenchOrdinalSuffix(rank);
    case 'fi':
    case 'da':
    case 'nb':
    case 'de':
    case 'cs':
      return `${rank}.`;
    default:
      return swedishOrdinalSuffix(rank);
  }
}
