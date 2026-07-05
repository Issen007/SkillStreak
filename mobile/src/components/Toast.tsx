import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface ToastProps {
  message: string;
  durationMs?: number;
  onDismiss: () => void;
}

/** Generic top-of-screen toast — used for H6's "+X min till lagets pott"
 * moment, the stale-consent-state recovery toast, and (Phase 2) the
 * roster/goal-builder confirmation toasts on "Laget"/"Mål". Moved here
 * (from home/components/) since it's no longer Home-tab-specific.
 * Auto-dismisses, dismiss-on-tap, no manual-close chrome (per the flow
 * doc's "never let the kid sit looking at ... no lingering modal"
 * intent). */
export function Toast({ message, durationMs = 2000, onDismiss }: ToastProps) {
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
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="box-none">
      <Pressable onPress={handleTap} style={styles.pressable}>
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
  pressable: {
    backgroundColor: colors.ink,
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
