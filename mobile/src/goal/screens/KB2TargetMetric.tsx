import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { TARGET_METRIC_OPTIONS, targetMetricLabel } from '../types';
import type { WeeklyGoalTargetMetric } from '../../api/types';

interface KB2Props {
  initialTargetMetric: WeeklyGoalTargetMetric | null;
  initialTargetValue: number | null;
  onNext: (targetMetric: WeeklyGoalTargetMetric, targetValue: number) => void;
  onBack: () => void;
}

/** Screen KB2 — target metric + team-wide target value. */
export function KB2TargetMetric({
  initialTargetMetric,
  initialTargetValue,
  onNext,
  onBack,
}: KB2Props) {
  const [targetMetric, setTargetMetric] = useState<WeeklyGoalTargetMetric | null>(
    initialTargetMetric,
  );
  const [targetValueText, setTargetValueText] = useState(
    initialTargetValue !== null ? String(initialTargetValue) : '',
  );

  const targetValue = Number.parseInt(targetValueText, 10);
  const canSubmit = targetMetric !== null && Number.isFinite(targetValue) && targetValue > 0;

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>Vad ska laget samla ihop — tillsammans?</Text>
      <Text style={styles.sub}>
        Vi räknar allas loggade träningstid, inte antal moves — så välj den typ av träning som
        passar bäst.
      </Text>

      <View style={styles.chipRow}>
        {TARGET_METRIC_OPTIONS.map((option) => {
          const selected = option.value === targetMetric;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setTargetMetric(option.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={styles.chipEmoji}>{option.icon}</Text>
              <Text style={styles.chipLabel}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Mål (minuter, hela lagets summa)</Text>
      <TextInput
        keyboardType="number-pad"
        placeholder="T.ex. 600"
        placeholderTextColor={colors.textMuted}
        value={targetValueText}
        onChangeText={setTargetValueText}
        style={styles.input}
      />
      <Text style={styles.helper}>Det här är hela lagets totalsumma, inte per spelare.</Text>

      {targetMetric && canSubmit ? (
        <View style={styles.previewCallout}>
          <Text style={styles.previewText}>
            Laget försöker tillsammans samla {targetValue} minuter{' '}
            {targetMetricLabel(targetMetric).toLowerCase()} innan målet slutar.
          </Text>
        </View>
      ) : null}

      <PrimaryButton
        label="Nästa"
        disabled={!canSubmit}
        onPress={() => {
          if (targetMetric && canSubmit) onNext(targetMetric, targetValue);
        }}
      />
      <SecondaryLink label="Tillbaka" onPress={onBack} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 21,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    width: '47%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  chipSelected: {
    borderColor: colors.gold,
    backgroundColor: '#FFF7E0',
  },
  chipEmoji: {
    fontSize: 22,
  },
  chipLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
    textAlign: 'center',
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.body,
    backgroundColor: colors.white,
    color: colors.ink,
  },
  helper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  previewCallout: {
    backgroundColor: '#FFF7E0',
    borderRadius: 14,
    padding: 12,
  },
  previewText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.ink,
  },
});
