// Starter avatar catalog proposed in docs/design/phase1-flows.md (Screen
// O3's "Judgment call"): 12 kid-friendly, sport-neutral animal/character
// emoji, 4x3 grid, all equal visual weight (no option implicitly favored).
// The actual catalog is backend-owned seed data per the contract — this is
// a client-side starting point, swap freely as long as the set stays
// sport-neutral, non-photo, and equally "cool" across options.
export interface AvatarOption {
  avatarId: string;
  emoji: string;
}

export const AVATAR_CATALOG: AvatarOption[] = [
  { avatarId: 'fox', emoji: '🦊' },
  { avatarId: 'wolf', emoji: '🐺' },
  { avatarId: 'owl', emoji: '🦉' },
  { avatarId: 'lion', emoji: '🦁' },
  { avatarId: 'bear', emoji: '🐻' },
  { avatarId: 'eagle', emoji: '🦅' },
  { avatarId: 'tiger', emoji: '🐯' },
  { avatarId: 'shark', emoji: '🦈' },
  { avatarId: 'dragon', emoji: '🐉' },
  { avatarId: 'panda', emoji: '🐼' },
  { avatarId: 'unicorn', emoji: '🦄' },
  { avatarId: 'robot', emoji: '🤖' },
];
