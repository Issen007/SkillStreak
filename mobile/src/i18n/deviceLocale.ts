import * as Localization from 'expo-localization';

import type { PlayerLocale } from '../api/types';

const SUPPORTED_LOCALES: readonly PlayerLocale[] = [
  'sv',
  'en',
  'fi',
  'da',
  'nb',
  'de',
  'cs',
  'fr',
];

/** Maps the device's own language setting to the nearest of the 8
 * languages this app actually supports, falling back to `sv` for anything
 * outside that set — docs/adr/0014-multi-language-support.md Decision 2
 * (widened 2026-08-01 to add German/Czech/French).
 *
 * Deliberately **local-only**: `expo-localization`'s `getLocales()` reads
 * the device's own settings synchronously, no network round-trip, and
 * carries no signal about *where* the device is — same "language, not
 * location" posture as Decision 1's choice to use `nb`/`de` (no region
 * subtag) rather than `nb-NO`/`de-DE`. See CLAUDE.md's no-location-
 * tracking constraint.
 *
 * Only ever used as Screen O0's *pre-selected default* on the picker —
 * never treated as a silent, permanent choice. The player always has to
 * tap to confirm (or change) it before it's submitted. */
export function getDeviceDefaultLocale(): PlayerLocale {
  const deviceLocales = Localization.getLocales();
  for (const locale of deviceLocales) {
    const code = locale.languageCode?.toLowerCase();
    if (!code) continue;
    // Norwegian's macrolanguage code ('no') and its Bokmål subtag ('nb')
    // both resolve to this app's single Norwegian option — see ADR-0014
    // Decision 1 on why there's no separate Nynorsk/region variant here.
    if (code === 'no' || code === 'nb') return 'nb';
    if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) {
      return code as PlayerLocale;
    }
  }
  return 'sv';
}
