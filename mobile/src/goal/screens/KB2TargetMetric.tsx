import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import {
  TARGET_METRIC_OPTIONS,
  targetMetricLabel,
  targetUnitForMetric,
  targetUnitLabel,
} from '../types';
import type { WeeklyGoalTargetMetric, WeeklyGoalTargetUnit } from '../../api/types';

interface KB2Props {
  initialTargetMetric: WeeklyGoalTargetMetric | null;
  initialTargetValue: number | null;
  onNext: (targetMetric: WeeklyGoalTargetMetric, targetValue: number) => void;
  onBack: () => void;
}

const UNIT_PLACEHOLDER: Record<WeeklyGoalTargetUnit, string> = {
  minutes: 'T.ex. 20',
  sessions: 'T.ex. 3',
};

/** Screen KB2 — activity type + per-player target, redesigned 2026-07-31
 * per docs/adr/0015-weekly-goal-per-player-completion.md +
 * docs/design/phase2.10-per-player-goal-flows.md: a new unit toggle
 * (minuter/pass) drives which of the 10 `WeeklyGoalTargetMetric` values
 * gets submitted, and every string is reworded from "the team's total" to
 * "each player." */
export function KB2TargetMetric({
  initialTargetMetric,
  initialTargetValue,
  onNext,
  onBack,
}: KB2Props) {
  const initialOption = initialTargetMetric
    ? TARGET_METRIC_OPTIONS.find(
        (option) =>
          option.minutesValue === initialTargetMetric || option.sessionsValue === initialTargetMetric,
      ) ?? null
    : null;

  const [selectedUnit, setSelectedUnit] = useState<WeeklyGoalTargetUnit>(
    initialTargetMetric ? targetUnitForMetric(initialTargetMetric) : 'minutes',
  );
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(
    initialOption ? TARGET_METRIC_OPTIONS.indexOf(initialOption) : null,
  );
  const [targetValueText, setTargetValueText] = useState(
    initialTargetValue !== null ? String(initialTargetValue) : '',
  );

  const selectedOption = selectedOptionIndex !== null ? TARGET_METRIC_OPTIONS[selectedOptionIndex] : null;
  const targetMetric =
    selectedOption !== null
      ? selectedUnit === 'minutes'
        ? selectedOption.minutesValue
        : selectedOption.sessionsValue
      : null;
  const targetValue = Number.parseInt(targetValueText, 10);
  const canSubmit = targetMetric !== null && Number.isFinite(targetValue) && targetValue > 0;
  const unitLabel = targetUnitLabel(selectedUnit);

  // Switching units resets the numeric field — a "20" typed while
  // "Minuter" was selected shouldn't silently become "20 pass" by muscle
  // memory (the flow doc's explicit guard).
  const handleSelectUnit = (unit: WeeklyGoalTargetUnit) => {
    if (unit === selectedUnit) return;
    setSelectedUnit(unit);
    setTargetValueText('');
  };

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>Vad ska varje spelare klara den här veckan?</Text>
      <Text style={styles.sub}>
        Varje spelare i laget behöver nå målet på egen hand — välj om det räknas i minuter eller
        pass, och vilken typ av träning som gäller.
      </Text>

      <View style={styles.unitRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: selectedUnit === 'minutes' }}
          onPress={() => handleSelectUnit('minutes')}
          style={[styles.unitPill, selectedUnit === 'minutes' && styles.unitPillSelected]}
        >
          <Text style={styles.unitPillLabel}>⏱️ Minuter</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: selectedUnit === 'sessions' }}
          onPress={() => handleSelectUnit('sessions')}
          style={[styles.unitPill, selectedUnit === 'sessions' && styles.unitPillSelected]}
        >
          <Text style={styles.unitPillLabel}>🔁 Antal pass</Text>
        </Pressable>
      </View>
      <Text style={styles.unitHelper}>Ett pass = en loggad träning, oavsett hur lång den var.</Text>

      <View style={styles.chipRow}>
        {TARGET_METRIC_OPTIONS.map((option, index) => {
          const selected = index === selectedOptionIndex;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setSelectedOptionIndex(index)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={styles.chipEmoji}>{option.icon}</Text>
              <Text style={styles.chipLabel}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Mål per spelare ({unitLabel})</Text>
      <TextInput
        keyboardType="number-pad"
        placeholder={UNIT_PLACEHOLDER[selectedUnit]}
        placeholderTextColor={colors.textMuted}
        value={targetValueText}
        onChangeText={setTargetValueText}
        style={styles.input}
      />
      <Text style={styles.helper}>
        Det här är målet varje spelare behöver nå på egen hand — inte lagets totalsumma.
      </Text>

      {targetMetric && canSubmit ? (
        <View style={styles.previewCallout}>
          <Text style={styles.previewText}>
            Varje spelare i laget behöver samla {targetValue} {unitLabel}{' '}
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
  unitRow: {
    flexDirection: 'row',
    gap: 10,
  },
  unitPill: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unitPillSelected: {
    borderColor: colors.gold,
    backgroundColor: '#FFF7E0',
  },
  unitPillLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  unitHelper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
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
