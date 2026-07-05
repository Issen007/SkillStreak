import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface GoalBonusTakeoverProps {
  awardedPoints: number;
  onDismiss: () => void;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Screen G2 — "Laget nådde veckans mål!" (docs/design/phase2-flows.md Part
 * 3): the bigger, rarer takeover shown to whichever player's training log
 * happened to cross the team's weekly-goal threshold. Deliberately bigger
 * and longer (~3.5s) than H5's SuccessOverlay banner — this is a team
 * achievement this player merely triggered, not a personal one, so the
 * copy credits the team rather than claiming sole credit. Fully
 * auto-dismissing, no tap required to close, same "celebrate and release"
 * principle as H5. Uses `gold` (never `flame`) per the style guide's
 * team-vs-individual color split, and white text on the gold fill per the
 * guide's own contrast rule ("solid flame or gold fill with white text"). */
export function GoalBonusTakeover({ awardedPoints, onDismiss }: GoalBonusTakeoverProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }),
      ]),
      Animated.delay(3150),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);
    sequence.start(({ finished }) => {
      if (finished) onDismiss();
    });
    return () => sequence.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[styles.card, { opacity, transform: [{ scale }] }]}
      pointerEvents="none"
    >
      <Text style={styles.icon}>🏆🎉</Text>
      <Text style={styles.headline}>Laget nådde veckans mål!</Text>
      <Text style={styles.sub}>Din logg var den som knuffade laget över målet!</Text>
      <Text style={styles.points}>
        +{numberFormatter.format(awardedPoints)} bonuspoäng till lagets pott! 🥇
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.gold,
    borderRadius: 22,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 7,
    zIndex: 20,
  },
  icon: {
    fontSize: 36,
  },
  headline: {
    fontFamily: fonts.headingBold,
    fontSize: 19,
    color: colors.white,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.white,
    textAlign: 'center',
    opacity: 0.92,
  },
  points: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.white,
    textAlign: 'center',
    marginTop: 4,
  },
});
