import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store's web implementation is a stub that throws on every
// call (no OS keychain equivalent for it to wrap) — confirmed live
// 2026-07-26: every local-flag read/write on the web build (try-it demo)
// rejected with "n.default.getValueWithKeyAsync/setValueWithKeyAsync is
// not a function", and every screen gating its render on one of those
// flags (Chat's/Shorts' "have you seen the intro" check, both starting
// from `useState<boolean | null>(null)`) got stuck showing a loading
// spinner forever, since the promise driving that state transition never
// resolved. Not a performance issue — permanently broken on web.
//
// Falls back to localStorage on web, same posture authStorage.ts's
// sessionToken already takes (real reduction in protection — no OS-level
// encryption-at-rest — acceptable here same as there: the web target only
// exists for the public try-it-out demo build, never a real device).
export async function secureGetItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function secureDeleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
