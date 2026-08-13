/**
 * Structural checks for the staff console.
 *
 * The console is a single vanilla-JS file with no test framework, and
 * that gap has cost real downtime: a refactor once deleted the `graphs`
 * and `campaigns` view functions while leaving their nav entries in
 * place, and the result — a blank admin console in production — was
 * discovered by a person, not by CI.
 *
 * These are not unit tests. They are the three checks that would have
 * caught that class of bug, and they run in under a second with no
 * browser and no dependencies.
 *
 *   node console/check-console.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'app.js'), 'utf8');
const html = readFileSync(join(here, 'index.html'), 'utf8');

const failures = [];
const note = (message) => failures.push(message);

/** Every `id: 'x'` inside the NAV declaration. */
function navIds() {
  const start = source.indexOf('var TABS');
  const end = source.indexOf('var ROUTE_TAB');
  if (start < 0 || end < 0) {
    note('Could not find TABS or ROUTE_TAB — this checker needs updating.');
    return [];
  }
  return [...source.slice(start, end).matchAll(/id:\s*'([a-zA-Z]+)'/g)].map(
    (m) => m[1],
  );
}

/** Every top-level key of the VIEWS object. */
function viewNames() {
  const start = source.indexOf('var VIEWS = {');
  if (start < 0) {
    note('Could not find VIEWS — this checker needs updating.');
    return [];
  }
  return [
    ...source.slice(start).matchAll(/^\s{4}([a-zA-Z]+):\s*function\s*\(/gm),
  ].map((m) => m[1]);
}

const nav = navIds();
const views = viewNames();

// 1. The blank-console bug, exactly. A nav entry whose view was deleted
//    renders an empty page with no error anywhere.
for (const id of nav) {
  if (!views.includes(id)) {
    note(`nav tab "${id}" has no VIEWS.${id} — that tab renders blank`);
  }
}

// 2. Every data-go target resolves. A typo here is a dead button, and a
//    dead button is indistinguishable from a slow one.
const routeTab = source.slice(
  source.indexOf('var ROUTE_TAB'),
  source.indexOf('function tabForRoute'),
);
for (const match of source.matchAll(/data-go="([a-zA-Z]+)/g)) {
  const root = match[1];
  if (!views.includes(root) && !routeTab.includes(`${root}:`)) {
    note(`data-go="${root}..." goes nowhere — no VIEWS.${root}`);
  }
}

// 3. Every CSS class the script emits exists in the stylesheet. This is
//    how `.chip` would have been caught: styled nowhere, rendered as
//    unstyled text, and visible only to someone who looked.
const declared = new Set(
  [...html.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{]/g)].map((m) => m[1]),
);
const emitted = new Set(
  [...source.matchAll(/class="([a-z][a-z0-9 -]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean),
);
for (const cls of emitted) {
  if (!declared.has(cls)) {
    note(`class="${cls}" is emitted by app.js but styled nowhere`);
  }
}

if (failures.length) {
  console.error('Console checks failed:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Console checks passed: ${nav.length} nav tabs, ${views.length} views, ` +
    `${emitted.size} classes.`,
);
