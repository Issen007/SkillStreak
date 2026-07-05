import * as SecureStore from 'expo-secure-store';

// `sessionToken` is the JWT scoped to a single playerId, issued once at
// POST /players — there's no separate login step (per
// docs/api/phase1-contract.md), so this is the only credential the app
// ever persists, and it lives in SecureStore, never AsyncStorage/plain
// storage.
const SESSION_TOKEN_KEY = 'skillstreak.sessionToken';

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}
