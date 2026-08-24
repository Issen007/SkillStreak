// Dynamic Expo config — everything still lives in app.json; this file only
// computes the one value app.json cannot.
//
// ## Why this exists
//
// `EXPO_PUBLIC_APP_VERSION` is what the profile screen prints and what
// every client crash report carries as its build. On the web export it has
// always been right: `site/Dockerfile` bakes `main-<sha>` or the release
// tag, matching what the API stamps into its own images and reports at
// `GET /health`.
//
// On **native** builds it was the literal string `"production"`, because
// `eas.json`'s `env` block is static JSON with nowhere to put a commit.
// So every TestFlight build's version line read "production", and every
// crash report's `client_app_version` said the same — which answers none
// of the questions those fields exist for. "Only since build 14" is the
// first thing anyone asks about a crash, and "production" cannot answer
// it. The profile screen's version line is also the check that would have
// caught the 2026-07-30 incident where production served an internal-test
// image, and it could not have caught anything while it printed a word.
//
// ## The format
//
// `<profile>-<short sha>` — deliberately the same shape the API already
// uses (`main-<sha>`, `prerelease-<sha>`), so a build's channel and its
// commit read the same way on both halves of the system. `EAS_BUILD_*` are
// set by EAS on the builder; none of them exist locally, which is exactly
// how a local run falls through to the web/Docker value and finally to
// `dev`.
//
// ## Order of precedence, and why
//
// 1. **EAS's own git commit** — only ever set on a real EAS build, and the
//    most specific thing available there.
// 2. **`EXPO_PUBLIC_APP_VERSION`** — the web export path, still correct and
//    deliberately untouched. `site/Dockerfile` owns it.
// 3. **`dev`** — a local run, and it should say so.
//
// Read at runtime through `src/appVersion.ts`, never directly.

const SHORT_SHA_LENGTH = 7;

function resolveAppVersion() {
  const sha = process.env.EAS_BUILD_GIT_COMMIT_HASH;
  if (sha) {
    // EAS_BUILD_PROFILE is set alongside it; guard anyway rather than
    // producing a string starting with "undefined-" if that ever changes.
    const profile = process.env.EAS_BUILD_PROFILE || 'eas';
    return `${profile}-${sha.slice(0, SHORT_SHA_LENGTH)}`;
  }
  return process.env.EXPO_PUBLIC_APP_VERSION || 'dev';
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    // `extra` is the supported channel for a value computed at config time
    // and read at runtime. It must be spread onto the existing object, not
    // replace it: `extra.eas.projectId` lives here too, and dropping it
    // detaches the app from its EAS project.
    appVersion: resolveAppVersion(),
  },
});
