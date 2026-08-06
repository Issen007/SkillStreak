import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface StreakGapBannerProps {
  missedDayCount: number;
  coverableWithBankedSavers: boolean;
  longestStreakCount: number;
}

/** docs/design/streak-savers-ui.md §2 — persistent, no-dismiss-control
 * banner rendered directly below `StreakCard` (above `TrainedButton`)
 * whenever `me.streak.pendingStreakGap` is non-null. Two visually and
 * tonally distinct variants: §2.1 "coverable" (reassuring, states
 * `missedDayCount`) and §2.2 "not coverable" (reframes forward via
 * `longestStreakCount`, deliberately never states `missedDayCount` — see
 * the component doc comment inline below for why). Same "reflects a real,
 * currently-true state, disappears on its own" posture as `WaitingCard`. */
export function StreakGapBanner({
  missedDayCount,
  coverableWithBankedSavers,
  longestStreakCount,
}: StreakGapBannerProps) {
  const { t } = useTranslation('home');

  if (coverableWithBankedSavers) {
    return (
      <View style={[styles.card, styles.cardCoverable]}>
        <View style={styles.headRow}>
          <Text style={styles.icon}>🛡️</Text>
          <Text style={styles.title}>{t('streakGapBanner.coverable.headline')}</Text>
        </View>
        <Text style={styles.body}>
          {t('streakGapBanner.coverable.body', { missedDayCount })}
        </Text>
      </View>
    );
  }

  // Not coverable — drop the shield/"protected" framing entirely (it
  // would be a false promise) and never state `missedDayCount` here: in
  // this branch the number is not good news, and a raw "you missed 11
  // days" reads as a scoreboard of shame with no offsetting reassurance
  // (docs/design/streak-savers-ui.md §2.2).
  return (
    <View style={[styles.card, styles.cardFreshStart]}>
      <View style={styles.headRow}>
        <Text style={styles.icon}>🌱</Text>
        <Text style={styles.title}>{t('streakGapBanner.tooLarge.headline')}</Text>
      </View>
      <Text style={styles.body}>
        {t('streakGapBanner.tooLarge.body', { longestStreakCount })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 18,
    gap: 8,
  },
  cardCoverable: {
    backgroundColor: colors.flameTint,
    borderColor: colors.flame,
  },
  cardFreshStart: {
    backgroundColor: colors.freshStartBg,
    borderColor: colors.freshStartBorder,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  icon: {
    fontSize: 20,
  },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textBody,
    lineHeight: 17,
  },
});
