import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface CatchUpBannerProps {
  awardedPoints: number;
  onDismiss: () => void;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Screen G3 — the one-time "catch-up" moment for every teammate who
 * *didn't* trigger the weekly-goal bonus themselves (docs/design/
 * phase2-flows.md Part 3). Deliberately low-key, not a takeover — this
 * player didn't just do anything, so it shouldn't perform as if they did.
 * Rendered at the AppShell level (not inside a single tab) since it needs
 * to show "at the top of whichever tab is open" per the flow doc, most
 * likely Home right after opening the app. Auto-dismisses after ~3s or on
 * tap; the caller is responsible for persisting the "seen" flag
 * immediately on first display, not on dismissal (see
 * `AppShell.checkForCatchUp`). */
export function CatchUpBanner({ awardedPoints, onDismiss }: CatchUpBannerProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    sequence.start(({ finished }) => {
      if (finished) onDismiss();
    });
    return () => sequence.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTap = () => {
    opacity.stopAnimation();
    onDismiss();
  };

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="box-none">
      <Pressable onPress={handleTap} style={styles.pressable}>
        <Text style={styles.text}>
          🎉 Laget nådde veckans mål! Laget fick +{numberFormatter.format(awardedPoints)}{' '}
          bonuspoäng.
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 8,
    left: 14,
    right: 14,
    zIndex: 15,
  },
  pressable: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.white,
    textAlign: 'center',
  },
});
