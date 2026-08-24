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
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'app.js'), 'utf8');
const html = readFileSync(join(here, 'index.html'), 'utf8');

const failures = [];
const note = (message) => failures.push(message);

/**
 * Does `app.js` parse at all.
 *
 * The obvious check, and it was missing — added 2026-08-24 after this
 * script reported "Console checks passed" on a file with a function
 * declaration inside an object literal. Every structural check below
 * works on the source as TEXT, so a file that cannot run passes all of
 * them cheerfully, which is worse than having no check: it ends the
 * investigation.
 *
 * `new vm.Script` compiles without executing, so this needs no browser
 * globals and cannot have side effects. It is the same move
 * `site/tools/check-site-build.mjs` already makes for the marketing
 * page's inline scripts; the console simply never got it.
 */
function checkParses() {
  try {
    new vm.Script(source, { filename: 'app.js' });
  } catch (error) {
    note(`app.js does not parse: ${error.message}`);
  }
}
checkParses();

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

// 4. Every SCREAMING_CASE constant the script references is declared in
//    it. This is the check that would have caught DRILL_AGE_BANDS: used
//    in two views, declared nowhere, throwing a ReferenceError that
//    surfaced only as "Something went wrong" in a view nobody had opened
//    yet. `node --check` cannot see it — it is valid syntax.
//
//    Comments and string literals are stripped first. Without that this
//    reports every "ADR", "HTTP" and "GET" in the prose, which is how the
//    first version of this check managed to fail on 70 non-problems.
function stripCommentsAndStrings(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (two === '/*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 2;
      continue;
    }
    if (two === '//') {
      const end = code.indexOf('\n', i);
      i = end < 0 ? code.length : end;
      continue;
    }
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      while (i < code.length && code[i] !== ch) {
        i += code[i] === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const code = stripCommentsAndStrings(source);
const declaredConsts = new Set(
  [...code.matchAll(/\bvar\s+([A-Z][A-Z0-9_]{2,})\s*=/g)].map((m) => m[1]),
);
// Browser and standard globals this file legitimately reaches for.
const knownGlobals = new Set(['NodeFilter', 'JSON', 'URL', 'Promise', 'Math']);
const undeclared = new Set();
// `(?<!\.)` so `NodeFilter.SHOW_TEXT` is read as a property access rather
// than as an undeclared global — a property on something that exists is
// not a ReferenceError.
for (const match of code.matchAll(/(?<![.\w])([A-Z][A-Z0-9_]{2,})\b/g)) {
  const name = match[1];
  if (!declaredConsts.has(name) && !knownGlobals.has(name)) {
    undeclared.add(name);
  }
}
for (const name of undeclared) {
  note(`${name} is referenced but never declared — a ReferenceError at runtime`);
}

if (failures.length) {
  console.error('Console checks failed:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Console checks passed: app.js parses, ${nav.length} nav tabs, ` +
    `${views.length} views, ${emitted.size} classes.`,
);
