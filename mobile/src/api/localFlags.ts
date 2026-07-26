import { secureGetItem, secureSetItem } from './secureStorage';

// Screen G3's one-time "catch-up" bonus banner needs to remember, per goal
// `id`, the last `bonusAwardedAt` value this device has already shown a
// banner for — a local-only concern per docs/design/phase2-flows.md's
// judgment call 9 (the contract has no server-side "has this player seen
// the bonus" field, deliberately). Reuses secureStorage.ts (SecureStore on
// native, localStorage on web) — the only persistence mechanism this app
// has (see authStorage.ts) — even though this value isn't a secret, rather
// than adding a new dependency (AsyncStorage) for one small flag.
function keyFor(goalId: string): string {
  return `skillstreak.lastSeenBonusAwardedAt.${goalId}`;
}

export async function getLastSeenBonusAwardedAt(goalId: string): Promise<string | null> {
  return secureGetItem(keyFor(goalId));
}

export async function setLastSeenBonusAwardedAt(goalId: string, value: string): Promise<void> {
  await secureSetItem(keyFor(goalId), value);
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
  const raw = await secureGetItem(captainKeyFor(teamId));
  if (raw === null) return null;
  return raw === 'true';
}

export async function setLastKnownIsCaptain(teamId: string, value: boolean): Promise<void> {
  await secureSetItem(captainKeyFor(teamId), value ? 'true' : 'false');
}

// --- Fas 2.6b: Screen CH0's one-time first-open explainer ------------------
const CHAT_INTRO_SEEN_KEY = 'skillstreak.hasSeenChatIntro';

export async function getHasSeenChatIntro(): Promise<boolean> {
  return (await secureGetItem(CHAT_INTRO_SEEN_KEY)) === 'true';
}

export async function setHasSeenChatIntro(): Promise<void> {
  await secureSetItem(CHAT_INTRO_SEEN_KEY, 'true');
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
  return secureGetItem(chatLastViewedKeyFor(teamId));
}

export async function setChatLastViewedAt(teamId: string, value: string): Promise<void> {
  await secureSetItem(chatLastViewedKeyFor(teamId), value);
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
  const raw = await secureGetItem(chatBlocksKeyFor(teamId));
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
  await secureSetItem(chatBlocksKeyFor(teamId), JSON.stringify(next));
}

export async function removeCachedChatBlock(
  teamId: string,
  blockedPlayerId: string,
): Promise<void> {
  const existing = await getCachedChatBlocks(teamId);
  const next = existing.filter((entry) => entry.blockedPlayerId !== blockedPlayerId);
  await secureSetItem(chatBlocksKeyFor(teamId), JSON.stringify(next));
}

// --- Fas 3: Screen V0's one-time first-open guardrail explainer ------------
// Shown once regardless of consentStatus, per docs/design/phase3-flows.md —
// same mechanism as CHAT_INTRO_SEEN_KEY above.
const CLIP_INTRO_SEEN_KEY = 'skillstreak.hasSeenClipIntro';

export async function getHasSeenClipIntro(): Promise<boolean> {
  return (await secureGetItem(CLIP_INTRO_SEEN_KEY)) === 'true';
}

export async function setHasSeenClipIntro(): Promise<void> {
  await secureSetItem(CLIP_INTRO_SEEN_KEY, 'true');
}

// --- Fas 3: unread-dot bookkeeping for the "Klipp" tab ----------------------
// Identical shape to chatLastViewedKeyFor above, per the flow doc's
// "Unread indicator" note (same tab-dot convention as Chatt).
function clipLastViewedKeyFor(teamId: string): string {
  return `skillstreak.clipLastViewedAt.${teamId}`;
}

export async function getClipLastViewedAt(teamId: string): Promise<string | null> {
  return secureGetItem(clipLastViewedKeyFor(teamId));
}

export async function setClipLastViewedAt(teamId: string, value: string): Promise<void> {
  await secureSetItem(clipLastViewedKeyFor(teamId), value);
}

// --- Fas 3: Screen V3's "you were challenged" one-time notice --------------
// Reuses the K5/G3 "diff a locally persisted flag" mechanism verbatim, per
// the flow doc's judgment call 6 — but since a player can be tagged in more
// than one clip, this tracks a *set* of clipIds already shown (not a single
// timestamp diff like K5/G3), persisted the moment the banner is *shown*
// (not dismissed), same "a killed app doesn't re-show it" rule.
function seenChallengeClipIdsKeyFor(teamId: string): string {
  return `skillstreak.seenChallengeClipIds.${teamId}`;
}

export async function getSeenChallengeClipIds(teamId: string): Promise<string[]> {
  const raw = await secureGetItem(seenChallengeClipIdsKeyFor(teamId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function addSeenChallengeClipId(teamId: string, clipId: string): Promise<void> {
  const existing = await getSeenChallengeClipIds(teamId);
  if (existing.includes(clipId)) return;
  await secureSetItem(
    seenChallengeClipIdsKeyFor(teamId),
    JSON.stringify([...existing, clipId]),
  );
}
