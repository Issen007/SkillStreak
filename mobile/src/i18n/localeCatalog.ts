import type { PlayerLocale } from '../api/types';

/** Screen O0's picker options. Each `label` is the language's own endonym
 * (what a speaker of that language calls it), not translated per the
 * active UI language — a language's name in its own picker row never
 * needs translating, and showing e.g. "Engelska" instead of "English" to
 * someone who reads English would defeat the point of the picker. That's
 * why this lives here as a plain catalog rather than a `sv.json` key, same
 * "not everything needs a translation key" posture as
 * `onboarding/avatarCatalog.ts`'s emoji set. */
export interface LocaleOption {
  code: PlayerLocale;
  label: string;
}

export const LOCALE_CATALOG: LocaleOption[] = [
  { code: 'sv', label: 'Svenska' },
  { code: 'en', label: 'English' },
  { code: 'fi', label: 'Suomi' },
  { code: 'da', label: 'Dansk' },
  { code: 'nb', label: 'Norsk (bokmål)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'cs', label: 'Čeština' },
  { code: 'fr', label: 'Français' },
];
