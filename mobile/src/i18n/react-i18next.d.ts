import 'i18next';

import sv from './locales/sv.json';

// Typed-resource augmentation (docs/adr/0014-multi-language-support.md
// Decision 2's stated reason for choosing i18next over lighter
// alternatives) — `sv.json` is the only locale file with real content for
// part (a), so it doubles as the compile-time shape every `t('...')` call
// is checked against: a typo'd or since-renamed key fails `tsc`, not just
// silently rendering nothing at runtime.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof sv;
    };
  }
}
