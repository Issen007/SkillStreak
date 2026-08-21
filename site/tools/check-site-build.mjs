#!/usr/bin/env node
/*
 * Guards the two ways `site/` can look correct in the repo and be broken
 * in the image: a substitution that mangles the page, and a file the page
 * loads that never gets copied in.
 *
 * ## 1. Substitutions must leave index.html as valid JavaScript.
 *
 * This exists because on 2026-08-21 they did not, and nothing noticed for
 * as long as the page has been deployed. `window.__TRY_IT_URL__ =
 * "__TRY_IT_URL__"` was substituted with `sed ... /g` — needed, because the
 * same token appears in two hrefs — and the `g` rewrote the property name
 * as well as the value:
 *
 *     window.https://try.skillstreak.xyz = "https://try.skillstreak.xyz";
 *
 * A syntax error kills the *whole* <script> block, so `__API_BASE__` on the
 * line above was never assigned either. Everything the page does against
 * the API then posted to `undefined/api/v1/...`: the signup form, the
 * site-visit counter, click tracking, and the embedded create-a-team
 * wizard, which falls back to a relative URL. All of it failed silently —
 * the form said "try again in a moment" and the analytics simply recorded
 * nothing.
 *
 * The Dockerfile's existing guard (`grep -qF "${VALUE}"`) could not catch
 * this: it verifies the substitution *happened*, which it did. What was
 * missing was a check that the result still parses. That is this file.
 *
 * ## 2. Every file the page references must be copied into the image
 *
 * `index.html` has loaded `<script src="/i18n.js">` since the day it was
 * written, and the Dockerfile never copied that file. It 404'd in
 * production for its entire existence: no language switcher, no flags, and
 * several hundred English translations that had never once been served,
 * while `site/i18n.js` sat correct in the repo and worked perfectly on
 * any local `python3 -m http.server`. Nothing could catch it — the file
 * exists, its contents are right, and the page that needs it is right.
 * Only the COPY list was wrong, and nothing read the COPY list.
 *
 * Run from `site/`: `node tools/check-site-build.mjs`
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Values shaped like the real ones — a URL with a scheme, a colon and
 * slashes, since those are exactly the characters that turn a mangled
 * property name into a syntax error. A placeholder-shaped stand-in would
 * substitute cleanly and prove nothing.
 */
const SUBSTITUTIONS = [
  { token: '__API_BASE_URL__', value: 'https://api.example.test', global: false },
  { token: '__TRY_IT_URL__', value: 'https://try.example.test', global: true },
];

let failures = 0;
const fail = (message) => {
  console.error(`✗ ${message}`);
  failures += 1;
};

const source = readFileSync(join(siteRoot, 'index.html'), 'utf8');

let substituted = source;
for (const { token, value, global } of SUBSTITUTIONS) {
  if (!substituted.includes(token)) {
    fail(`${token} appears nowhere in index.html — is the Dockerfile still substituting it?`);
    continue;
  }
  substituted = substituted.replaceAll(
    ...(global ? [token, value] : [token, value]),
  );
  // Non-global sed replaces only the first occurrence *per line*; every
  // token here occurs at most once per line, so replaceAll matches what
  // the Dockerfile actually does in both cases.
}

// Only the tokens the Dockerfile actually substitutes. A broader "any
// __UPPER__" sweep would flag the globals' own names, which are supposed
// to survive — that is the whole point of them differing from the tokens.
const leftovers = SUBSTITUTIONS.map(({ token }) => token).filter((token) =>
  substituted.includes(token),
);
if (leftovers.length > 0) {
  fail(`placeholder(s) left unsubstituted: ${leftovers.join(', ')}`);
}

/*
 * Parse every inline script the page carries, not just the config block:
 * the bug that prompted this file was in the config block, but a
 * substitution landing anywhere else would break its block just as
 * silently.
 */
const scripts = [...substituted.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
if (scripts.length === 0) fail('no inline <script> blocks found — has the page changed shape?');

scripts.forEach(([, body], index) => {
  try {
    // Compiles without running: enough to reject a syntax error, and it
    // must not actually execute page code here.
    new Function(body);
  } catch (error) {
    fail(
      `inline <script> #${index + 1} does not parse after substitution: ${error.message}\n` +
        `   first offending line: ${
          body.split('\n').find((line) => line.includes('window.')) ?? '(unknown)'
        }`,
    );
  }
});

/*
 * The specific shape the outage produced: a property name that is a URL.
 * Redundant with the parse check above and kept anyway, because it names
 * the actual failure in the output instead of a column number.
 */
for (const line of substituted.split('\n')) {
  // Skip comments: prose that quotes the broken shape is not the bug.
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
  if (/\bwindow\.[A-Za-z0-9_$]*:/.test(line)) {
    fail(`a global's name was rewritten into a URL: ${line.trim()}`);
  }
}

/*
 * i18n.js is keyed by the Swedish source string, which makes two silent
 * failures possible and neither is visible in review.
 *
 * 1. **A duplicate key** is legal JavaScript: the last one quietly wins.
 *    One was introduced and caught by hand on 2026-08-21; nothing would
 *    have reported it.
 * 2. **A key whose source no longer exists** is what the file's own header
 *    warns about — edit the Swedish copy and its translation detaches,
 *    leaving English visitors reading Swedish with no error anywhere.
 *
 * Both are plain text problems, so they are checked here rather than
 * needing a browser.
 */
const i18n = readFileSync(join(siteRoot, 'i18n.js'), 'utf8');

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&nbsp;': '\u00a0', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&rsquo;': '\u2019', '&lsquo;': '\u2018', '&ldquo;': '\u201c', '&rdquo;': '\u201d',
};
const decodeEntities = (text) =>
  text.replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity] ?? entity);

/*
 * The page's text nodes, collapsed exactly as `apply()` collapses them —
 * trimmed, runs of whitespace squeezed to one space, and the same
 * "longer than two characters" filter its TreeWalker uses.
 */
const pageNodes = new Set(
  source
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '<>')
    .split(/<[^>]*>/)
    .map((node) => decodeEntities(node).trim().replace(/\s+/g, ' '))
    .filter((node) => node.length > 2),
);

for (const [, locale, block] of i18n.matchAll(
  /^ {4}(\w+): \{$([\s\S]*?)^ {4}\},?$/gm,
)) {
  const keys = [...block.matchAll(/^ {6}'((?:[^'\\]|\\.)+)':/gm)].map(
    ([, key]) => key,
  );
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key)) {
      fail(`i18n.js "${locale}" has a duplicate key — the later one silently wins: ${key}`);
    }
    seen.add(key);
  }

  /*
   * Compared per *text node*, not against the page as one string. A
   * substring sweep passes whenever the phrase survives anywhere else on
   * the page, which is exactly the case a reword produces — verified: it
   * missed "Slutna lagbubblor" being changed in its heading while the same
   * words remained in a sentence further down. `apply()` matches whole
   * collapsed nodes, so this has to as well.
   */
  for (const key of keys) {
    const literal = decodeEntities(key.replace(/\\'/g, "'"));
    if (!pageNodes.has(literal)) {
      fail(
        `i18n.js "${locale}" translates a string that is no longer a text node ` +
          `in index.html, so it can never apply: ${literal.slice(0, 70)}…`,
      );
    }
  }
}

/*
 * Every local file index.html pulls in must appear in the Dockerfile's
 * COPY list. Checking the repo for the file is not enough — that was
 * always true of i18n.js — so this reads the Dockerfile itself.
 */
const dockerfile = readFileSync(join(siteRoot, 'Dockerfile'), 'utf8');
const copiedPaths = [...dockerfile.matchAll(/^COPY\s+\S*site\/(\S+)/gm)].map(
  ([, path]) => path.replace(/\/$/, ''),
);

const referenced = [
  ...source.matchAll(/<script[^>]*\ssrc="\/([^"]+)"/g),
  ...source.matchAll(/<link[^>]*\shref="\/([^"]+)"/g),
].map(([, path]) => path);

for (const path of [...new Set(referenced)]) {
  // The Expo web export lives under a different nginx root and is copied
  // from another build stage, so it is not in site/ and not checked here.
  if (path.startsWith('app/')) continue;
  const isCopied = copiedPaths.some(
    (copied) => copied === path || path.startsWith(`${copied}/`),
  );
  if (!isCopied) {
    fail(
      `index.html loads /${path}, but site/Dockerfile never copies it into ` +
        `the image — it will 404 in production while working locally.`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} problem(s) in the site build.`);
  process.exit(1);
}
console.log(
  `site build OK: ${SUBSTITUTIONS.length} placeholders, ${scripts.length} inline ` +
    `scripts parse, ${referenced.length} referenced file(s) copied into the image, ` +
    `i18n keys unique and all still matched.`,
);
