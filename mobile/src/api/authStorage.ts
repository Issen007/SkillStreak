import { secureDeleteItem, secureGetItem, secureSetItem } from './secureStorage';

// `sessionToken` is the JWT scoped to a single playerId, issued once at
// POST /players — there's no separate login step (per
// docs/api/phase1-contract.md), so this is the only credential the app
// ever persists. See secureStorage.ts for the SecureStore/localStorage
// platform split this relies on.
const SESSION_TOKEN_KEY = 'skillstreak.sessionToken';

export async function getSessionToken(): Promise<string | null> {
  return secureGetItem(SESSION_TOKEN_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await secureSetItem(SESSION_TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  await secureDeleteItem(SESSION_TOKEN_KEY);
}
