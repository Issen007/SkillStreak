import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { useCountUp } from '../useCountUp';

interface StreakCardProps {
  currentStreakCount: number;
  /** Shows the "Loggat idag ✓" chip (H3) — omitted on H1. */
  alreadyLoggedToday: boolean;
}

/** Flame-colored streak card — shared between H1 and H3, per style-guide's
 * rule that flame is always the "mine"/individual-streak motif. */
export function StreakCard({ currentStreakCount, alreadyLoggedToday }: StreakCardProps) {
  const { t } = useTranslation('home');
  const displayedCount = useCountUp(currentStreakCount);
  const scale = useRef(new Animated.Value(1)).current;
  const previousCount = useRef(currentStreakCount);

  useEffect(() => {
    if (previousCount.current === currentStreakCount) return;
    previousCount.current = currentStreakCount;
    // Small bounce pulse on the flame icon when the streak actually moves
    // (H5's "flame icon doing a small bounce/scale pulse").
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.25, useNativeDriver: true, friction: 3 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }),
    ]).start();
  }, [currentStreakCount, scale]);

  return (
    <View style={styles.card}>
      {alreadyLoggedToday ? (
        <View style={styles.checkChip}>
          <Text style={styles.checkChipText}>{t('streakCard.loggedTodayChip')}</Text>
        </View>
      ) : null}
      <Animated.Text style={[styles.flame, { transform: [{ scale }] }]}>🔥</Animated.Text>
      <View style={styles.textBlock}>
        <Text style={styles.count}>{t('streakCard.count', { count: displayedCount })}</Text>
        <Text style={styles.label}>{t('streakCard.label')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.flame,
    borderRadius: 20,
    paddingVertical: 17,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    position: 'relative',
  },
  flame: {
    fontSize: 30,
  },
  textBlock: {
    flexShrink: 1,
  },
  count: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    color: colors.white,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.white,
    opacity: 0.92,
  },
  checkChip: {
    position: 'absolute',
    top: -10,
    right: -4,
    backgroundColor: colors.success,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  checkChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    color: colors.white,
  },
});
