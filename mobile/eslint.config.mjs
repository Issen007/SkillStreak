import parser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint for the app — deliberately two rules, not a rule set.
 *
 * **Added 2026-08-21, after a crash a lint rule would have caught.** Two
 * hooks were written below an early return in `ClipsScreen`, so they ran
 * on some renders and not others; React threw "rendered more hooks than
 * during the previous render" and the Shorts tab died on every open. It
 * reached a TestFlight build with `tsc --noEmit` and the i18n parity
 * check both clean, because neither can see it.
 * `react-hooks/rules-of-hooks` sees exactly it.
 *
 * **Why not `eslint-config-expo`**, which would be the obvious choice:
 * it pulls in `eslint-plugin-react`, which is incompatible with the
 * eslint 10 line (`contextOrFilename.getFilename is not a function`) and
 * crashes before linting a single file. Pinning back to eslint 9 to suit
 * it would work, but the broader rule set is not what this is for — see
 * below.
 *
 * **Two rules rather than a sweep**, on purpose. This app has never been
 * linted. A full rule set today would produce hundreds of findings and
 * bury the one that matters, and a check people scroll past is how the
 * stale expo-doctor red taught everyone to ignore CI in the first place.
 * More rules can be added later, deliberately, once these are holding.
 *
 *   rules-of-hooks    error. The failure is a runtime crash on every
 *                     open, not a style opinion.
 *   exhaustive-deps   warn. A stale closure reads yesterday's state and
 *                     is genuinely hard to catch in review — but real
 *                     exceptions exist, and an error here invites blanket
 *                     disable comments, which is worse than the warning.
 */
export default [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'android/**',
      'ios/**',
      'scripts/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
