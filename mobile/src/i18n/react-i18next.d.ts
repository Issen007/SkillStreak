import 'i18next';

import svChat from './locales/sv/chat.json';
import svClips from './locales/sv/clips.json';
import svCommon from './locales/sv/common.json';
import svGoal from './locales/sv/goal.json';
import svHome from './locales/sv/home.json';
import svOnboarding from './locales/sv/onboarding.json';
import svTeam from './locales/sv/team.json';

// Typed-resource augmentation (docs/adr/0014-multi-language-support.md
// Decision 2's stated reason for choosing i18next over lighter
// alternatives) — every `sv/*.json` file is the only set with real content
// so far, so it doubles as the compile-time shape every `t('...')` call
// (scoped via `useTranslation('<namespace>')`) is checked against: a
// typo'd or since-renamed key fails `tsc`, not just silently rendering
// nothing at runtime. One `resources` entry per namespace, matching
// `i18n/index.ts`'s `NAMESPACES` list exactly.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof svCommon;
      onboarding: typeof svOnboarding;
      home: typeof svHome;
      team: typeof svTeam;
      goal: typeof svGoal;
      chat: typeof svChat;
      clips: typeof svClips;
    };
  }
}
