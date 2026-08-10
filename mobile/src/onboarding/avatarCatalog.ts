import type { ImageSourcePropType } from 'react-native';

/**
 * The avatar catalog (Screen O3).
 *
 * Originally 12 kid-friendly emoji. Since 2026-08-10 most entries carry
 * real character art (`brand/avatars/`, sliced from the project owner's
 * sample sheet), rendered by `<Avatar>` — which falls back to `emoji` for
 * any entry without an image.
 *
 * **`emoji` is not decoration and must not be removed.** Three of the
 * original twelve ids have no matching art, and players already have those
 * ids stored on their accounts:
 *
 * - `owl` — the sheet's owl tile was rendered in its *selected* state, on
 *   a peach card that cannot be cleanly removed without risking the
 *   character itself (see brand/avatars/README.md).
 * - `shark` — the sheet has a dolphin. A different animal.
 * - `robot` — the sheet has a human racing driver. Also not the same.
 *
 * Remapping any of those to the nearest-looking art would silently change
 * what an existing player's avatar *is*, which is their identity in the
 * app rather than a rendering detail. They keep their emoji until art
 * exists for them specifically.
 *
 * `require` calls are literal on purpose: React Native's bundler resolves
 * image paths statically, so a computed path does not work.
 */
export interface AvatarOption {
  avatarId: string;
  /** Fallback, and the only representation for ids without art. */
  emoji: string;
  /** Character art, when this id has some. */
  image?: ImageSourcePropType;
}

export const AVATAR_CATALOG: AvatarOption[] = [
  // --- the original twelve, ids unchanged so no stored avatar breaks ---
  {
    avatarId: 'fox',
    emoji: '🦊',
    image: require('../../assets/avatars/fox.png') as ImageSourcePropType,
  },
  {
    avatarId: 'wolf',
    emoji: '🐺',
    image: require('../../assets/avatars/wolf.png') as ImageSourcePropType,
  },
  // No art — see the docstring above.
  { avatarId: 'owl', emoji: '🦉' },
  {
    avatarId: 'lion',
    emoji: '🦁',
    image: require('../../assets/avatars/lion.png') as ImageSourcePropType,
  },
  {
    avatarId: 'bear',
    emoji: '🐻',
    image: require('../../assets/avatars/bear.png') as ImageSourcePropType,
  },
  {
    avatarId: 'eagle',
    emoji: '🦅',
    image: require('../../assets/avatars/eagle.png') as ImageSourcePropType,
  },
  {
    avatarId: 'tiger',
    emoji: '🐯',
    image: require('../../assets/avatars/tiger.png') as ImageSourcePropType,
  },
  // No art — the sheet has a dolphin, which is a different animal.
  { avatarId: 'shark', emoji: '🦈' },
  {
    avatarId: 'dragon',
    emoji: '🐉',
    image: require('../../assets/avatars/dragon.png') as ImageSourcePropType,
  },
  {
    avatarId: 'panda',
    emoji: '🐼',
    image: require('../../assets/avatars/panda.png') as ImageSourcePropType,
  },
  {
    avatarId: 'unicorn',
    emoji: '🦄',
    image: require('../../assets/avatars/unicorn.png') as ImageSourcePropType,
  },
  // No art — the sheet has a human racing driver, not a robot.
  { avatarId: 'robot', emoji: '🤖' },

  // --- new characters, all with art -----------------------------------
  {
    avatarId: 'dolphin',
    emoji: '🐬',
    image: require('../../assets/avatars/dolphin.png') as ImageSourcePropType,
  },
  {
    avatarId: 'racer',
    emoji: '🏎️',
    image: require('../../assets/avatars/racer.png') as ImageSourcePropType,
  },
  {
    avatarId: 'moose',
    emoji: '🫎',
    image: require('../../assets/avatars/moose.png') as ImageSourcePropType,
  },
  {
    avatarId: 'hare',
    emoji: '🐰',
    image: require('../../assets/avatars/hare.png') as ImageSourcePropType,
  },
  {
    avatarId: 'swan',
    emoji: '🦢',
    image: require('../../assets/avatars/swan.png') as ImageSourcePropType,
  },
  {
    avatarId: 'lynx',
    emoji: '🐆',
    image: require('../../assets/avatars/lynx.png') as ImageSourcePropType,
  },
  {
    avatarId: 'gorilla',
    emoji: '🦍',
    image: require('../../assets/avatars/gorilla.png') as ImageSourcePropType,
  },
  {
    avatarId: 'cheetah',
    emoji: '🐅',
    image: require('../../assets/avatars/cheetah.png') as ImageSourcePropType,
  },
  {
    avatarId: 'kangaroo',
    emoji: '🦘',
    image: require('../../assets/avatars/kangaroo.png') as ImageSourcePropType,
  },
  {
    avatarId: 'otter',
    emoji: '🦦',
    image: require('../../assets/avatars/otter.png') as ImageSourcePropType,
  },
  {
    avatarId: 'raccoon',
    emoji: '🦝',
    image: require('../../assets/avatars/raccoon.png') as ImageSourcePropType,
  },
  {
    avatarId: 'seal',
    emoji: '🦭',
    image: require('../../assets/avatars/seal.png') as ImageSourcePropType,
  },
  {
    avatarId: 'badger',
    emoji: '🦡',
    image: require('../../assets/avatars/badger.png') as ImageSourcePropType,
  },
  {
    avatarId: 'horse',
    emoji: '🐴',
    image: require('../../assets/avatars/horse.png') as ImageSourcePropType,
  },
];

/** Single lookup, so no call site re-implements the `.find()` + fallback. */
export function avatarOptionFor(avatarId: string | null | undefined) {
  return AVATAR_CATALOG.find((option) => option.avatarId === avatarId);
}
