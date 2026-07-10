import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// `sessionToken` is the JWT scoped to a single playerId, issued once at
// POST /players — there's no separate login step (per
// docs/api/phase1-contract.md), so this is the only credential the app
// ever persists, and it lives in SecureStore, never AsyncStorage/plain
// storage — on native. On web there's no OS keychain equivalent for
// expo-secure-store to wrap (its web shim is an empty stub that throws on
// every call), so this falls back to localStorage there instead. That's a
// real reduction in protection (no OS-level encryption-at-rest), but the
// web target only exists for the public try-it-out demo build, never for
// a real device — see tools/hosted-web-export's own docs before using this
// for anything more sensitive than a demo session token.
const SESSION_TOKEN_KEY = 'skillstreak.sessionToken';

export async function getSessionToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(SESSION_TOKEN_KEY) ?? null;
  }
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(SESSION_TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}
