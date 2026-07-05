import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { formatSwedishDate } from '../../utils/formatDate';

interface GoalCardProps {
  title: string;
  description: string;
  progressMinutes: number;
  targetValue: number;
  percentComplete: number;
  endDate: string;
  goalMet: boolean;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Screen G1's card — also reused verbatim as KB4's live preview. Uses
 * `gold`, never `flame` (docs/design/phase2-flows.md's team-wide-progress
 * judgment call), but deliberately *lighter weight* than the home tab's
 * VM-Guld card (smaller, no gradient hero treatment) so the two "gold"
 * meters stay visually distinguishable — VM-Guld is the season-long
 * destination, this is a short-lived sub-goal. */
export function GoalCard({
  title,
  description,
  progressMinutes,
  targetValue,
  percentComplete,
  endDate,
  goalMet,
}: GoalCardProps) {
  const widthAnim = useRef(new Animated.Value(percentComplete)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: percentComplete,
      duration: 1100,
      useNativeDriver: false,
    }).start();
  }, [percentComplete, widthAnim]);

  const widthInterpolated = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.eyebrow}>Veckans mål 🎯</Text>
        {goalMet ? (
          <View style={styles.metChip}>
            <Text style={styles.metChipText}>Nått! 🎉</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.sub}>Satt av lagets kapten</Text>

      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}

      <View style={styles.track}>
        <Animated.View
          style={[styles.fill, { width: goalMet ? '100%' : widthInterpolated }]}
        />
      </View>
      <Text style={styles.progressText}>
        {numberFormatter.format(progressMinutes)} / {numberFormatter.format(targetValue)} minuter
      </Text>
      <Text style={styles.endDate}>Slutar {formatSwedishDate(endDate)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.ink,
  },
  metChip: {
    backgroundColor: '#EAF6EE',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  metChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.success,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  title: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
    marginTop: 4,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textBody,
    lineHeight: 16,
  },
  track: {
    marginTop: 6,
    width: '100%',
    height: 10,
    borderRadius: 999,
    backgroundColor: '#F3EEE3',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
  progressText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.goldText,
  },
  endDate: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
});
