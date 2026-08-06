import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { useCountUp } from '../useCountUp';
import { SaverInfoSheet } from './SaverInfoSheet';

interface StreakCardProps {
  currentStreakCount: number;
  /** Shows the "Loggat idag ✓" chip (H3) — omitted on H1. */
  alreadyLoggedToday: boolean;
  /** docs/design/streak-savers-ui.md §1 — current banked-saver balance
   * (0-4), driving the corner badge below. Always passed whenever
   * `StreakCard` renders (same "always visible" instruction the ADR
   * gives). */
  bankedStreakSaverCount: number;
}

/** Flame-colored streak card — shared between H1 and H3, per style-guide's
 * rule that flame is always the "mine"/individual-streak motif. */
export function StreakCard({
  currentStreakCount,
  alreadyLoggedToday,
  bankedStreakSaverCount,
}: StreakCardProps) {
  const { t } = useTranslation('home');
  const displayedCount = useCountUp(currentStreakCount);
  const scale = useRef(new Animated.Value(1)).current;
  const previousCount = useRef(currentStreakCount);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);

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

  const hasSavers = bankedStreakSaverCount > 0;

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hasSavers
            ? t('streakCard.saverBadgeA11y', { count: bankedStreakSaverCount })
            : t('streakCard.saverBadgeA11yZero')
        }
        hitSlop={10}
        onPress={() => setInfoSheetOpen(true)}
        style={[styles.saverBadge, hasSavers ? styles.saverBadgeActive : styles.saverBadgeEmpty]}
      >
        <Text style={[styles.saverBadgeIcon, !hasSavers && styles.saverBadgeIconEmpty]}>🛡️</Text>
        <Text style={[styles.saverBadgeText, hasSavers ? styles.saverBadgeTextActive : styles.saverBadgeTextEmpty]}>
          {bankedStreakSaverCount}
        </Text>
      </Pressable>
      <SaverInfoSheet
        visible={infoSheetOpen}
        bankedStreakSaverCount={bankedStreakSaverCount}
        onClose={() => setInfoSheetOpen(false)}
      />
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
  // docs/design/streak-savers-ui.md §1 — mirrors `checkChip` but on the
  // opposite corner so the two can never collide even when both show at
  // once (`alreadyLoggedToday` + a nonzero banked count are unrelated and
  // can co-occur).
  saverBadge: {
    position: 'absolute',
    bottom: -10,
    right: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  // count > 0 — "protected".
  saverBadgeActive: {
    backgroundColor: colors.white,
  },
  // count === 0 — "not yet earned": recessive, not negative.
  saverBadgeEmpty: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  saverBadgeIcon: {
    fontSize: 11,
  },
  saverBadgeIconEmpty: {
    opacity: 0.75,
  },
  saverBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
  },
  saverBadgeTextActive: {
    color: colors.flameText,
  },
  saverBadgeTextEmpty: {
    color: colors.white,
    opacity: 0.85,
  },
});
