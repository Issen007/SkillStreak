#!/usr/bin/env node
/*
 * Asserts that `site/Dockerfile`'s build-time substitutions leave
 * index.html as valid JavaScript.
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
 * Run from `site/`: `node tools/check-substitutions.mjs`
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

if (failures > 0) {
  console.error(`\n${failures} problem(s) in site/index.html's build-time substitutions.`);
  process.exit(1);
}
console.log(
  `site substitutions OK: ${SUBSTITUTIONS.length} placeholders, ${scripts.length} inline scripts parse.`,
);
