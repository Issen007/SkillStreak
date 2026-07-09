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

// --- Fas 2.6a: Screen K5's "last known viewerIsCaptain" flag ---------------
// Same diff-against-a-locally-persisted-value mechanism as the bonus flag
// above, reused verbatim per docs/design/phase2.6-2.7-flows.md's judgment
// call 3 — AppShell compares this against the dashboard's fresh
// `viewerIsCaptain` on every app open/foreground to decide whether to show
// Screen K5's celebratory (or, optionally, neutral "handed off") banner.
function captainKeyFor(teamId: string): string {
  return `skillstreak.lastKnownIsCaptain.${teamId}`;
}

/** `null` means "never recorded yet for this team" (e.g. first app open) —
 * AppShell treats that as "just record the baseline, don't show a banner"
 * so a fresh install never mistakes an existing captain for a promotion. */
export async function getLastKnownIsCaptain(teamId: string): Promise<boolean | null> {
  const raw = await SecureStore.getItemAsync(captainKeyFor(teamId));
  if (raw === null) return null;
  return raw === 'true';
}

export async function setLastKnownIsCaptain(teamId: string, value: boolean): Promise<void> {
  await SecureStore.setItemAsync(captainKeyFor(teamId), value ? 'true' : 'false');
}

// --- Fas 2.6b: Screen CH0's one-time first-open explainer ------------------
const CHAT_INTRO_SEEN_KEY = 'skillstreak.hasSeenChatIntro';

export async function getHasSeenChatIntro(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CHAT_INTRO_SEEN_KEY)) === 'true';
}

export async function setHasSeenChatIntro(): Promise<void> {
  await SecureStore.setItemAsync(CHAT_INTRO_SEEN_KEY, 'true');
}

// --- Fas 2.6b: unread-dot bookkeeping for the "Chatt" tab -------------------
// Per docs/design/phase2.6-2.7-flows.md's "Unread indicator" note: a plain
// per-team "last viewed this team's chat at" timestamp, cleared the moment
// the Chatt tab is opened, compared against the newest message a
// foreground check happens to see.
function chatLastViewedKeyFor(teamId: string): string {
  return `skillstreak.chatLastViewedAt.${teamId}`;
}

export async function getChatLastViewedAt(teamId: string): Promise<string | null> {
  return SecureStore.getItemAsync(chatLastViewedKeyFor(teamId));
}

export async function setChatLastViewedAt(teamId: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(chatLastViewedKeyFor(teamId), value);
}

// --- Fas 2.6b: Screen CH5's client-cache-backed block list ------------------
// Real, stated gap (see ADR-0007/the flow doc's Screen CH5): there is no
// `GET .../chat/blocks` endpoint, so this is the *only* record of a
// player's own blocks — populated the moment Screen CH4's block call
// succeeds, read back by Screen CH5. Doesn't survive a fresh install/new
// device (flagged for architect as a small fast-follow, not solved here).
export interface CachedChatBlock {
  blockedPlayerId: string;
  screenName: string;
  avatarId: string;
}

function chatBlocksKeyFor(teamId: string): string {
  return `skillstreak.chatBlocks.${teamId}`;
}

export async function getCachedChatBlocks(teamId: string): Promise<CachedChatBlock[]> {
  const raw = await SecureStore.getItemAsync(chatBlocksKeyFor(teamId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedChatBlock[]) : [];
  } catch {
    return [];
  }
}

export async function addCachedChatBlock(
  teamId: string,
  block: CachedChatBlock,
): Promise<void> {
  const existing = await getCachedChatBlocks(teamId);
  if (existing.some((entry) => entry.blockedPlayerId === block.blockedPlayerId)) return;
  const next = [...existing, block];
  await SecureStore.setItemAsync(chatBlocksKeyFor(teamId), JSON.stringify(next));
}

export async function removeCachedChatBlock(
  teamId: string,
  blockedPlayerId: string,
): Promise<void> {
  const existing = await getCachedChatBlocks(teamId);
  const next = existing.filter((entry) => entry.blockedPlayerId !== blockedPlayerId);
  await SecureStore.setItemAsync(chatBlocksKeyFor(teamId), JSON.stringify(next));
}
