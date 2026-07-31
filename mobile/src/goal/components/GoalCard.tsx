import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { formatSwedishDate } from '../../utils/formatDate';
import { targetMetricIcon, targetMetricLabel, targetUnitLabel } from '../types';
import type { WeeklyGoalTargetMetric, WeeklyGoalTargetUnit } from '../../api/types';

interface GoalCardProps {
  title: string;
  description: string;
  targetMetric: WeeklyGoalTargetMetric;
  targetUnit: WeeklyGoalTargetUnit;
  targetValue: number;
  eligiblePlayerCount: number;
  completedPlayerCount: number;
  percentComplete: number;
  goalMet: boolean;
  endDate: string;
  /** "Se vem som är klar →" → Screen G1D, shown whenever a goal exists
   * (even in the vacuous-truth `eligiblePlayerCount: 0` case) — omitted
   * entirely in `isPreview` mode instead, since there's nothing real to
   * link to yet. */
  onSeeDetail?: () => void;
  /** KB4 only — the real per-player completion count/bar can't be known
   * before a goal is published (`eligiblePlayerCount` is a live roster
   * query), so a fabricated "0 av N" would be a guess, not data. Swaps the
   * headline figure + progress bar for a clearly-labeled placeholder. */
  isPreview?: boolean;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Screen G1's card — also reused verbatim on Screen K1 (the "Laget" tab,
 * closing that screen's pre-existing "fetches weeklyGoal, never renders
 * it" gap) and as KB4's live preview. Redesigned 2026-07-31 per
 * docs/adr/0015-weekly-goal-per-player-completion.md +
 * docs/design/phase2.10-per-player-goal-flows.md: leads with "X av Y
 * lagkamrater klara" (per-player completion), not a pooled minute total.
 * Uses `gold`, never `flame` (team-wide, not individual-streak motif), but
 * deliberately *lighter weight* than the home tab's VM-Guld card (smaller,
 * no gradient hero treatment) so the two "gold" meters stay visually
 * distinguishable — VM-Guld is the season-long destination, this is a
 * short-lived sub-goal. */
export function GoalCard({
  title,
  description,
  targetMetric,
  targetUnit,
  targetValue,
  eligiblePlayerCount,
  completedPlayerCount,
  percentComplete,
  goalMet,
  endDate,
  onSeeDetail,
  isPreview = false,
}: GoalCardProps) {
  const isVacuous = eligiblePlayerCount === 0;
  const widthAnim = useRef(new Animated.Value(percentComplete)).current;
  const metricIcon = targetMetricIcon(targetMetric);

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

      {isPreview ? (
        <View style={styles.previewCallout}>
          <Text style={styles.previewText}>
            Så här ser kortet ut när målet är aktivt — riktiga lagkamrater och vem som är klar
            visas då.
          </Text>
        </View>
      ) : (
        <>
          {isVacuous ? (
            <Text style={styles.headlineMuted}>
              Ingen i laget kan tävla om det här målet just nu.
            </Text>
          ) : (
            <Text style={styles.headline}>
              {completedPlayerCount} av {eligiblePlayerCount} lagkamrater klara
            </Text>
          )}
          <View style={[styles.track, isVacuous && styles.trackEmpty]}>
            {isVacuous ? null : (
              <Animated.View
                style={[styles.fill, { width: goalMet ? '100%' : widthInterpolated }]}
              />
            )}
          </View>
        </>
      )}

      <View style={styles.metaRow}>
        <View style={styles.metricChip}>
          <Text style={styles.metricChipText}>
            {metricIcon} {targetMetricLabel(targetMetric)} · {numberFormatter.format(targetValue)}{' '}
            {targetUnitLabel(targetUnit)} var
          </Text>
        </View>
      </View>
      <Text style={styles.endDate}>Slutar {formatSwedishDate(endDate)}</Text>

      {!isPreview && onSeeDetail ? (
        <Text style={styles.detailLink} onPress={onSeeDetail}>
          Se vem som är klar →
        </Text>
      ) : null}
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
  headline: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.goldText,
    marginTop: 4,
  },
  headlineMuted: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  track: {
    marginTop: 2,
    width: '100%',
    height: 10,
    borderRadius: 999,
    backgroundColor: '#F3EEE3',
    overflow: 'hidden',
  },
  trackEmpty: {
    backgroundColor: '#ECEAE3',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
  previewCallout: {
    marginTop: 4,
    backgroundColor: '#F7F5EF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
  },
  previewText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textBody,
    lineHeight: 15,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  metricChip: {
    backgroundColor: '#FFF7E0',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  metricChipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    color: colors.ink,
  },
  endDate: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  detailLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.ink,
    textDecorationLine: 'underline',
    marginTop: 3,
  },
});
