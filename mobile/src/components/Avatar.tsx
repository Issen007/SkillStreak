import { Image, StyleSheet, Text, View } from 'react-native';

import { avatarOptionFor } from '../onboarding/avatarCatalog';

interface AvatarProps {
  avatarId: string | null | undefined;
  /** Rendered width/height in px. The art is square. */
  size: number;
  /** Font size for the emoji fallback. Defaults to ~0.8 × size, which
   * matches how the emoji looked before the art existed. */
  emojiSize?: number;
}

/**
 * One player's avatar — character art when the id has some, the emoji
 * fallback when it does not.
 *
 * **Every avatar in the app renders through here.** Before this, 17 files
 * each did their own `AVATAR_CATALOG.find(...)?.emoji ?? '🙂'` inside a
 * `<Text>`, which cannot show an image. Leaving even one of those in place
 * would show the same player as a photo on one screen and an emoji on the
 * next — worse than either alone — so the lookup lives in exactly one
 * component now.
 *
 * The fallback chain matters and is deliberate: art → the catalog's own
 * emoji → 🙂 for an id the catalog has never heard of (a value written by
 * an older client, or seed data). A player is never rendered as blank.
 */
export function Avatar({ avatarId, size, emojiSize }: AvatarProps) {
  const option = avatarOptionFor(avatarId);

  if (option?.image) {
    return (
      <Image
        source={option.image}
        // The art is drawn on white, so a round frame would show corners.
        // `contain` keeps the character whole rather than cropping a head.
        style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.emojiWrap, { width: size, height: size }]}>
      <Text style={{ fontSize: emojiSize ?? Math.round(size * 0.8) }}>
        {option?.emoji ?? '🙂'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: '#FFFFFF',
  },
  emojiWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
