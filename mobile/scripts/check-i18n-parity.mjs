#!/usr/bin/env node
// Checks that every locale under src/i18n/locales has exactly the same set
// of translation keys as the reference locale.
//
// Why this exists: a missing key does not fail the build and does not
// crash at runtime — i18next silently falls back, so the user sees
// Swedish inside an otherwise Spanish screen. That is invisible in code
// review and invisible in `tsc`. It became worth guarding when the ninth
// locale (es) was added by hand, 650 strings at a time.
//
// Deliberately a plain Node script with no dependencies: the mobile
// package has no test runner, and introducing one to assert a property
// this simple would be a much bigger change than the property is worth.
// Runs in CI beside the existing typecheck.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const REFERENCE = 'sv';

/** Every leaf key path in a namespace object, e.g. "v0.bullet1". */
function keyPaths(value, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([k, v]) =>
      keyPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

function readLocale(locale) {
  const dir = join(LOCALES_DIR, locale);
  const out = new Map();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    out.set(file, new Set(keyPaths(parsed)));
  }
  return out;
}

const locales = readdirSync(LOCALES_DIR).filter((d) =>
  statSync(join(LOCALES_DIR, d)).isDirectory(),
).sort();

if (!locales.includes(REFERENCE)) {
  console.error(`Reference locale "${REFERENCE}" is missing.`);
  process.exit(1);
}

const reference = readLocale(REFERENCE);
let failures = 0;

for (const locale of locales) {
  if (locale === REFERENCE) continue;
  const actual = readLocale(locale);

  for (const [file, refKeys] of reference) {
    const keys = actual.get(file);
    if (!keys) {
      console.error(`✖ ${locale}: missing namespace ${file}`);
      failures += 1;
      continue;
    }
    const missing = [...refKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !refKeys.has(k));
    for (const k of missing) {
      console.error(`✖ ${locale}/${file}: missing key "${k}"`);
      failures += 1;
    }
    for (const k of extra) {
      console.error(`✖ ${locale}/${file}: key "${k}" not in ${REFERENCE}`);
      failures += 1;
    }
  }
  for (const file of actual.keys()) {
    if (!reference.has(file)) {
      console.error(`✖ ${locale}: namespace ${file} not in ${REFERENCE}`);
      failures += 1;
    }
  }
}

/*
 * Second pass: every `t('...')` the app calls must exist in the reference
 * locale.
 *
 * Parity above proves the locales agree with each other. It cannot see a
 * key that is missing from *all* of them, and that failure is uglier than
 * the one parity guards: i18next falls back to the key path itself, so a
 * child reads "clipActions.shareHint" on the button. `tsc` cannot catch
 * it — the argument is just a string.
 *
 * Only literal calls are checked. A key built from a template literal is
 * skipped rather than guessed at, which keeps this free of false alarms at
 * the cost of not covering dynamic lookups.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // `.d.ts` holds types, never calls — and its prose mentions `t('...')`.
    return /\.tsx?$/.test(path) && !path.endsWith('.d.ts') ? [path] : [];
  });
}

const referenceKeys = new Set(
  [...reference.entries()].flatMap(([file, keys]) =>
    [...keys].map((key) => `${file}:${key}`),
  ),
);

for (const file of sourceFiles(SRC)) {
  const source = readFileSync(file, 'utf8');
  const defaultNamespace = /useTranslation\(\s*'([^']+)'/.exec(source)?.[1];
  // Line by line so a comment describing `t('...')` is not read as a call.
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  for (const [, key] of code.matchAll(/\bt\(\s*'([^']+)'/g)) {
    const qualified = key.includes(':')
      ? key
      : defaultNamespace && `${defaultNamespace}:${key}`;
    if (!qualified) continue;
    const [namespace, path] = qualified.split(':');
    if (!referenceKeys.has(`${namespace}.json:${path}`)) {
      console.error(
        `✖ ${file.replace(`${SRC}/`, '')}: t('${key}') has no ${REFERENCE} ` +
          `translation — i18next would render the key path to the user`,
      );
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error(`\ni18n parity FAILED — ${failures} problem(s).`);
  process.exit(1);
}
console.log(
  `i18n parity OK: ${locales.length} locales × ${reference.size} namespaces, ` +
    `${[...reference.values()].reduce((n, s) => n + s.size, 0)} keys each.`,
);
