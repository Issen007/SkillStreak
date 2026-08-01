import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import cs from './locales/cs.json';
import da from './locales/da.json';
import de from './locales/de.json';
import en from './locales/en.json';
import fi from './locales/fi.json';
import fr from './locales/fr.json';
import nb from './locales/nb.json';
import sv from './locales/sv.json';
import { getDeviceDefaultLocale } from './deviceLocale';
// No runtime import of `./react-i18next.d` needed — it's an ambient
// `declare module 'i18next'` augmentation, picked up automatically by
// `tsc` from anywhere in the project; importing it here would just be a
// bare `.d.ts` import Metro can't resolve at runtime.

// docs/adr/0014-multi-language-support.md Decision 2 (Fas 4.3, part a).
//
// `fallbackLng: 'sv'` is the load-bearing setting here, not incidental
// config: `en`/`fi`/`da`/`nb`/`de`/`cs`/`fr` start as empty `{}` resource
// files (part (b)'s remaining, independently-schedulable work) and this is
// what makes every key they don't have yet silently render the Swedish
// copy instead of a blank/broken screen. Don't remove or narrow it without
// re-reading that ADR.
//
// Purely local/in-memory: every locale's JSON ships in the app bundle
// (the ADR's "single flat resource file per language" layout, no
// namespace-splitting at this app's size), so there's no async
// resource-loading backend to configure or await here — `i18n.init()`
// below is synchronous and ready by the time anything imports this
// module.
void i18n.use(initReactI18next).init({
  resources: {
    sv: { translation: sv },
    en: { translation: en },
    fi: { translation: fi },
    da: { translation: da },
    nb: { translation: nb },
    de: { translation: de },
    cs: { translation: cs },
    fr: { translation: fr },
  },
  // Pre-selects the nearest supported language from the device's own
  // settings (local-only — see deviceLocale.ts) so Screen O0 itself opens
  // already showing a sensible default, before the player has made an
  // explicit choice. Screen O0 calls `i18n.changeLanguage` synchronously
  // once they do.
  lng: getDeviceDefaultLocale(),
  fallbackLng: 'sv',
  interpolation: {
    // React Native's <Text> already renders interpolated values as plain
    // text, not raw HTML — i18next's own escaping exists for contexts
    // this app never has (dangerouslySetInnerHTML-style rendering).
    escapeValue: false,
  },
});

export default i18n;
