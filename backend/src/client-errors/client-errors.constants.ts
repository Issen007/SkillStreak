/**
 * The platforms a report may claim to come from.
 *
 * A fixed vocabulary rather than an open string, for the same reason the
 * link-click counter's `link` field is one: this is an unauthenticated
 * write, and an open string column is an unbounded write surface. `web`
 * is included because try.skillstreak.xyz serves the same app as an Expo
 * web export, and a crash there is as real as one on a phone.
 */
export const CLIENT_ERROR_PLATFORMS = ['ios', 'android', 'web'] as const;
