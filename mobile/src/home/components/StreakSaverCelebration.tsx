import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface StreakSaverCelebrationProps {
  currentStreakCount: number;
  bankedStreakSaverCount: number;
  onDismiss: () => void;
}

/** docs/design/streak-savers-ui.md §3 — the one-time "streak saved!"
 * celebration, modeled directly on `GoalBonusTakeover.tsx` (same full-width
 * absolute-positioned takeover, same animation timing verbatim, same
 * four-line structure). The one thing that changes is color and words:
 * `colors.flame`, not `colors.gold` — this is purely an individual-streak
 * event, per the app's own flame="mine"/gold="ours" style-guide split.
 * Triggered exactly once, from the training-log POST response whose
 * `streak.streakSaverSpent > 0`, never from any polled/derived state. */
export function StreakSaverCelebration({
  currentStreakCount,
  bankedStreakSaverCount,
  onDismiss,
}: StreakSaverCelebrationProps) {
  const { t } = useTranslation('home');
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
      <Text style={styles.icon}>🛡️🔥</Text>
      <Text style={styles.headline}>{t('streakSaverCelebration.headline')}</Text>
      <Text style={styles.sub}>{t('streakSaverCelebration.sub')}</Text>
      <Text style={styles.detail}>
        {t('streakSaverCelebration.detail', {
          currentStreakCount,
          bankedStreakSaverCount,
        })}
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
    backgroundColor: colors.flame,
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
  detail: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.white,
    textAlign: 'center',
    marginTop: 4,
  },
});
