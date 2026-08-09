import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import csChat from './locales/cs/chat.json';
import csClips from './locales/cs/clips.json';
import csCommon from './locales/cs/common.json';
import csGoal from './locales/cs/goal.json';
import csHome from './locales/cs/home.json';
import csOnboarding from './locales/cs/onboarding.json';
import csPt from './locales/cs/pt.json';
import csTeam from './locales/cs/team.json';
import daChat from './locales/da/chat.json';
import daClips from './locales/da/clips.json';
import daCommon from './locales/da/common.json';
import daGoal from './locales/da/goal.json';
import daHome from './locales/da/home.json';
import daOnboarding from './locales/da/onboarding.json';
import daPt from './locales/da/pt.json';
import daTeam from './locales/da/team.json';
import deChat from './locales/de/chat.json';
import deClips from './locales/de/clips.json';
import deCommon from './locales/de/common.json';
import deGoal from './locales/de/goal.json';
import deHome from './locales/de/home.json';
import deOnboarding from './locales/de/onboarding.json';
import dePt from './locales/de/pt.json';
import deTeam from './locales/de/team.json';
import enChat from './locales/en/chat.json';
import enClips from './locales/en/clips.json';
import enCommon from './locales/en/common.json';
import enGoal from './locales/en/goal.json';
import enHome from './locales/en/home.json';
import enOnboarding from './locales/en/onboarding.json';
import enPt from './locales/en/pt.json';
import enTeam from './locales/en/team.json';
import fiChat from './locales/fi/chat.json';
import fiClips from './locales/fi/clips.json';
import fiCommon from './locales/fi/common.json';
import fiGoal from './locales/fi/goal.json';
import fiHome from './locales/fi/home.json';
import fiOnboarding from './locales/fi/onboarding.json';
import fiPt from './locales/fi/pt.json';
import fiTeam from './locales/fi/team.json';
import frChat from './locales/fr/chat.json';
import frClips from './locales/fr/clips.json';
import frCommon from './locales/fr/common.json';
import frGoal from './locales/fr/goal.json';
import frHome from './locales/fr/home.json';
import frOnboarding from './locales/fr/onboarding.json';
import frPt from './locales/fr/pt.json';
import frTeam from './locales/fr/team.json';
import nbChat from './locales/nb/chat.json';
import nbClips from './locales/nb/clips.json';
import nbCommon from './locales/nb/common.json';
import nbGoal from './locales/nb/goal.json';
import nbHome from './locales/nb/home.json';
import nbOnboarding from './locales/nb/onboarding.json';
import nbPt from './locales/nb/pt.json';
import nbTeam from './locales/nb/team.json';
import svChat from './locales/sv/chat.json';
import svClips from './locales/sv/clips.json';
import svCommon from './locales/sv/common.json';
import svGoal from './locales/sv/goal.json';
import svHome from './locales/sv/home.json';
import svOnboarding from './locales/sv/onboarding.json';
import svPt from './locales/sv/pt.json';
import svTeam from './locales/sv/team.json';
import { getDeviceDefaultLocale } from './deviceLocale';
// No runtime import of `./react-i18next.d` needed — it's an ambient
// `declare module 'i18next'` augmentation, picked up automatically by
// `tsc` from anywhere in the project; importing it here would just be a
// bare `.d.ts` import Metro can't resolve at runtime.

// docs/adr/0014-multi-language-support.md Decision 2 (Fas 4.3, part a),
// namespaced 2026-08-01 ahead of part (b)'s real per-screen-area
// translation work — one file per (language, feature area) pair instead
// of one giant flat file per language, specifically so several agents'
// translation passes can each own a disjoint set of files (no two areas'
// work ever touches the same JSON) rather than all converging on one
// shared resource file. The ADR's original "a single flat file is fine at
// this app's current [3-key pilot] screen count" call was correct for
// part (a) and is superseded now that part (b) covers the whole app.
//
// `fallbackLng: 'sv'` is still the load-bearing setting: every non-`sv`
// namespace file starts as `{}` until its area's translation pass lands,
// and this is what makes an untranslated key silently render the Swedish
// copy instead of a blank/broken screen.
//
// Purely local/in-memory: every namespace's JSON ships in the app bundle,
// so there's no async resource-loading backend to configure or await here
// — `i18n.init()` below is synchronous and ready by the time anything
// imports this module.
const NAMESPACES = [
  'common',
  'onboarding',
  'home',
  'team',
  'goal',
  'chat',
  'clips',
  'pt',
] as const;

void i18n.use(initReactI18next).init({
  ns: NAMESPACES,
  defaultNS: 'common',
  resources: {
    sv: {
      common: svCommon,
      onboarding: svOnboarding,
      home: svHome,
      team: svTeam,
      goal: svGoal,
      chat: svChat,
      clips: svClips,
      pt: svPt,
    },
    en: {
      common: enCommon,
      onboarding: enOnboarding,
      home: enHome,
      team: enTeam,
      goal: enGoal,
      chat: enChat,
      clips: enClips,
      pt: enPt,
    },
    fi: {
      common: fiCommon,
      onboarding: fiOnboarding,
      home: fiHome,
      team: fiTeam,
      goal: fiGoal,
      chat: fiChat,
      clips: fiClips,
      pt: fiPt,
    },
    da: {
      common: daCommon,
      onboarding: daOnboarding,
      home: daHome,
      team: daTeam,
      goal: daGoal,
      chat: daChat,
      clips: daClips,
      pt: daPt,
    },
    nb: {
      common: nbCommon,
      onboarding: nbOnboarding,
      home: nbHome,
      team: nbTeam,
      goal: nbGoal,
      chat: nbChat,
      clips: nbClips,
      pt: nbPt,
    },
    de: {
      common: deCommon,
      onboarding: deOnboarding,
      home: deHome,
      team: deTeam,
      goal: deGoal,
      chat: deChat,
      clips: deClips,
      pt: dePt,
    },
    cs: {
      common: csCommon,
      onboarding: csOnboarding,
      home: csHome,
      team: csTeam,
      goal: csGoal,
      chat: csChat,
      clips: csClips,
      pt: csPt,
    },
    fr: {
      common: frCommon,
      onboarding: frOnboarding,
      home: frHome,
      team: frTeam,
      goal: frGoal,
      chat: frChat,
      clips: frClips,
      pt: frPt,
    },
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
