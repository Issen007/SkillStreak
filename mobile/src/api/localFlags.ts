import * as SecureStore from 'expo-secure-store';

// Screen G3's one-time "catch-up" bonus banner needs to remember, per goal
// `id`, the last `bonusAwardedAt` value this device has already shown a
// banner for — a local-only concern per docs/design/phase2-flows.md's
// judgment call 9 (the contract has no server-side "has this player seen
// the bonus" field, deliberately). Reuses SecureStore — the only
// persistence mechanism this app has (see authStorage.ts) — even though
// this value isn't a secret, rather than adding a new dependency
// (AsyncStorage) for one small flag.
function keyFor(goalId: string): string {
  return `skillstreak.lastSeenBonusAwardedAt.${goalId}`;
}

export async function getLastSeenBonusAwardedAt(goalId: string): Promise<string | null> {
  return SecureStore.getItemAsync(keyFor(goalId));
}

export async function setLastSeenBonusAwardedAt(goalId: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(goalId), value);
}
