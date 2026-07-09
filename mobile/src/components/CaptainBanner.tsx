import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface CaptainBannerProps {
  /** "promoted" — this device's `viewerIsCaptain` just flipped
   * `false -> true` (Screen K5, the resolved case ADR-0006 flagged as
   * open). "demoted" — the reverse flip on a device that *wasn't* the one
   * that performed the transfer (e.g. a captain's second device) — an
   * optional, cuttable nicety per the flow doc's judgment call 3. */
  variant: 'promoted' | 'demoted';
  onDismiss: () => void;
}

/** Screen K5 — the one-time captaincy-change banner. Same fade-in/delay/
 * fade-out `Animated` sequence, layout, and tap-to-dismiss handling as
 * `CatchUpBanner` (a deliberate, accepted duplication — see
 * mobile/README.md's "Known duplication" note; not consolidated here to
 * avoid touching a second live celebration path without dedicated review).
 * Rendered at the AppShell level (not inside a single tab), same reasoning
 * as `CatchUpBanner`: this needs to show "at the top of whichever tab is
 * open," not just inside "Laget". */
export function CaptainBanner({ variant, onDismiss }: CaptainBannerProps) {
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
    <Animated.View
      style={[styles.container, { opacity }, variant === 'demoted' && styles.containerNeutral]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={handleTap}
        style={[styles.pressable, variant === 'demoted' && styles.pressableNeutral]}
      >
        {variant === 'promoted' ? (
          <>
            <Text style={styles.text}>👑 Grattis! Du är nu lagets kapten.</Text>
            <Text style={styles.sub}>Du hittar dina nya verktyg i Laget-fliken.</Text>
          </>
        ) : (
          <Text style={styles.textNeutral}>Kaptensskapet gick vidare till en lagkompis.</Text>
        )}
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
  containerNeutral: {
    zIndex: 14,
  },
  pressable: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  pressableNeutral: {
    backgroundColor: colors.pausedBg,
    borderWidth: 1,
    borderColor: colors.pausedBorder,
  },
  text: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.white,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.white,
    textAlign: 'center',
  },
  textNeutral: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
    textAlign: 'center',
  },
});
