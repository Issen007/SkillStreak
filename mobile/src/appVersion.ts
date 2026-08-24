import Constants from 'expo-constants';

/**
 * What this build actually is — the one string the profile screen prints
 * and every crash report carries.
 *
 * Two sources, because there are genuinely two build paths and each knows
 * something the other does not:
 *
 * - **`extra.appVersion`**, computed in `app.config.js`. On an EAS build
 *   this is `<profile>-<short sha>`, the only place the commit is
 *   available.
 * - **`EXPO_PUBLIC_APP_VERSION`**, inlined by Metro. This is the web
 *   export's path — `site/Dockerfile` bakes `main-<sha>` or the release
 *   tag into it, matching the API's own stamp.
 *
 * `app.config.js` already falls back to the env var, so in practice the
 * first source answers both cases. The second is kept as a real fallback
 * rather than defensive habit: if the config ever fails to reach the
 * bundle, printing the Docker-baked value is much better than printing
 * `dev` on a shipped build and quietly telling everyone the wrong thing.
 *
 * Never read either of them directly. Two call sites reading two sources
 * in two orders is how a version line and a crash report start disagreeing
 * about the same build.
 */
export const APP_VERSION: string =
  (Constants.expoConfig?.extra?.appVersion as string | undefined) ||
  process.env.EXPO_PUBLIC_APP_VERSION ||
  'dev';
