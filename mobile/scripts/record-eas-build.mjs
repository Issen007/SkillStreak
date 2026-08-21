#!/usr/bin/env node
/**
 * Records the newest finished EAS build into `mobile/.last-eas-build.json`,
 * which is what CI's drift check compares against.
 *
 * Run this from `mobile/` after a build finishes:
 *
 *   node scripts/record-eas-build.mjs
 *
 * It asks EAS rather than accepting an argument, so the recorded commit is
 * the one that was really built. That matters: the whole point of the file
 * is to answer "what can someone actually install", and a hand-typed value
 * answers "what did someone believe they built".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = new URL('../.last-eas-build.json', import.meta.url);

function newestFinishedBuild() {
  // `--json` needs `--non-interactive`; eas-cli prints progress to stderr,
  // which is why only stdout is parsed.
  const out = execFileSync(
    'npx',
    ['eas-cli', 'build:list', '--limit', '20', '--status', 'finished',
     '--json', '--non-interactive'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const builds = JSON.parse(out);
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error('EAS returned no finished builds.');
  }
  // Newest first is eas-cli's own ordering; not re-sorted, so a future
  // change to that ordering shows up as a wrong answer rather than being
  // silently compensated for here.
  return builds[0];
}

const build = newestFinishedBuild();
const previous = JSON.parse(readFileSync(MARKER, 'utf8'));

const next = {
  _comment: previous._comment,
  buildId: build.id,
  commit: build.gitCommitHash,
  platform: build.platform,
  profile: build.buildProfile,
  buildNumber: String(build.appBuildVersion ?? ''),
  finishedAt: (build.completedAt ?? '').slice(0, 10),
};

writeFileSync(MARKER, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `Recorded ${next.platform}/${next.profile} build ${next.buildNumber} ` +
    `at ${next.commit?.slice(0, 7)} (${next.finishedAt}).`,
);
console.log('Commit this file so CI stops reporting drift.');
