import { Platform } from 'react-native';
import * as Network from 'expo-network';

/**
 * Whether to start pushing a clip's bytes *before* the player has finished
 * captioning it.
 *
 * **Why this is a WiFi-only decision** (project owner, 2026-08-09): the
 * background upload exists so a child stops waiting, but starting it on a
 * metered connection means their family pays for a video they may never
 * post — they can still change their mind on the caption screen. Uploading
 * on submit is what the app did before, and on cellular it is the honest
 * default: data is spent only once they have actually committed.
 *
 * **This deliberately does not block anything.** On cellular the upload
 * still happens, just later — falling back to exactly the pre-2026-08-09
 * behaviour. A child on mobile data gets the old experience, never a
 * refusal, which is the difference between a considerate default and a
 * feature that appears broken away from home.
 *
 * **It is also not a setting, and shouldn't become one.** The device's own
 * per-app cellular toggle is app-wide — turning it off breaks logging a
 * session, chat and the feed too, not just uploads — so it cannot express
 * this rule. And a 9-13-year-old should not have to find and reason about
 * a data-usage preference; the app can just behave well by default.
 *
 * Fails OPEN on any uncertainty: an unknown connection type, an
 * unsupported platform, or a thrown check all pre-upload. Getting it wrong
 * that way costs some cellular data; getting it wrong the other way brings
 * the slow flow back for everyone whose network we merely failed to
 * identify.
 */
export async function shouldPreUpload(): Promise<boolean> {
  // On web there is no metered/unmetered distinction to read, and the
  // "try it" site runs on a laptop far more often than on a phone plan.
  if (Platform.OS === 'web') return true;

  try {
    const state = await Network.getNetworkStateAsync();
    return state.type !== Network.NetworkStateType.CELLULAR;
  } catch {
    return true;
  }
}
