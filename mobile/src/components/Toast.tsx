import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface ToastProps {
  message: string;
  durationMs?: number;
  /** 'default' (dark background, used for confirmation-style toasts) or
   * 'gold' (this app's celebratory/goal-related treatment — same visual
   * weight as `CaptainBanner`'s promoted state). 'gold' also raises
   * `zIndex` slightly above 'default' so it can stack in front of a
   * plain toast if both were ever briefly in play. Defaults to
   * 'default'. */
  variant?: 'default' | 'gold';
  onDismiss: () => void;
}

/** Generic top-of-screen toast — used for H6's "+X min till lagets pott"
 * moment, the stale-consent-state recovery toast, (Phase 2) the
 * roster/goal-builder confirmation toasts on "Laget"/"Mål", Screen V3's
 * "you were challenged" banner on "Klipp", and (consolidated here per
 * mobile/README.md's former "Known duplication" note) Screen G3's
 * "catch-up" bonus banner via the 'gold' variant. Moved here (from
 * home/components/) since it's no longer Home-tab-specific. Auto-
 * dismisses, dismiss-on-tap, no manual-close chrome (per the flow doc's
 * "never let the kid sit looking at ... no lingering modal" intent). */
export function Toast({ message, durationMs = 2000, variant = 'default', onDismiss }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(durationMs),
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
    <Animated.View
      style={[styles.container, variant === 'gold' && styles.containerGold, { opacity }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={handleTap}
        style={[styles.pressable, variant === 'gold' && styles.pressableGold]}
      >
        <Text style={styles.text}>{message}</Text>
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
    zIndex: 10,
  },
  containerGold: {
    zIndex: 15,
  },
  pressable: {
    backgroundColor: colors.ink,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  pressableGold: {
    backgroundColor: colors.gold,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.white,
    textAlign: 'center',
  },
});
