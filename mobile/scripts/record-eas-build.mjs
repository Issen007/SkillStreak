#!/usr/bin/env node
/**
 * Records the newest finished EAS build **per platform** into
 * `mobile/.last-eas-build.json`, which is what CI's drift check compares
 * against.
 *
 * Run this from `mobile/` after a build finishes:
 *
 *   node scripts/record-eas-build.mjs
 *
 * It asks EAS rather than accepting an argument, so the recorded commit is
 * the one that was really built. That matters: the whole point of the file
 * is to answer "what can someone actually install", and a hand-typed value
 * answers "what did someone believe they built".
 *
 * **Per platform since 2026-08-22.** It used to record a single newest
 * build across both. That was fine while only iOS was being built, and
 * became actively misleading the moment Android caught up: recording the
 * Android build would have turned the drift check green while every iOS
 * tester was still on build 14, without the daily reminder or the parental
 * gate. A green check that means "one of your platforms is current" is
 * worse than a red one, because this project has been caught five separate
 * times by the gap between "merged" and "installed".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = new URL('../.last-eas-build.json', import.meta.url);

function finishedBuilds() {
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
  return builds;
}

const builds = finishedBuilds();
const previous = JSON.parse(readFileSync(MARKER, 'utf8'));

/*
 * Newest per platform. A platform absent from the last 20 finished builds
 * keeps whatever was recorded for it before — dropping it would quietly
 * stop the drift check watching that platform at all, which is the
 * failure this file exists to make impossible.
 */
const recorded = { ...(previous.builds ?? {}) };
for (const build of builds) {
  const platform = build.platform;
  if (!platform || recorded[platform]?._fresh) continue;
  recorded[platform] = {
    _fresh: true,
    buildId: build.id,
    commit: build.gitCommitHash,
    profile: build.buildProfile,
    buildNumber: String(build.appBuildVersion ?? ''),
    finishedAt: (build.completedAt ?? '').slice(0, 10),
  };
}
for (const entry of Object.values(recorded)) delete entry._fresh;

writeFileSync(
  MARKER,
  `${JSON.stringify({ _comment: previous._comment, builds: recorded }, null, 2)}\n`,
);
for (const [platform, entry] of Object.entries(recorded)) {
  console.log(
    `${platform}/${entry.profile} build ${entry.buildNumber} ` +
      `at ${entry.commit?.slice(0, 7)} (${entry.finishedAt}).`,
  );
}
console.log('Commit this file so CI stops reporting drift.');
