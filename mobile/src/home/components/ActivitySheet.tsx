import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ActivityType } from '../../api/types';

interface ActivityOption {
  activityType: ActivityType;
  emoji: string;
  label: string;
}

const ACTIVITIES: ActivityOption[] = [
  { activityType: 'fitness', emoji: '🏋️', label: 'Kondition' },
  { activityType: 'drill', emoji: '🏑', label: 'Teknik/övning' },
  { activityType: 'running', emoji: '🏃', label: 'Löpning' },
  { activityType: 'other', emoji: '⭐', label: 'Annat' },
];

const DURATIONS: { label: string; minutes: number }[] = [
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '20 min', minutes: 20 },
  { label: '30+ min', minutes: 30 },
];

interface ActivitySheetProps {
  visible: boolean;
  loading: boolean;
  errorText?: string | null;
  onClose: () => void;
  onSubmit: (activityType: ActivityType, durationMinutes: number) => void;
}

/** State H2 — a bottom sheet, not a form: the contract requires
 * `activityType` + `durationMinutes` on every log, resolved here as one
 * extra tap of big chips rather than a text form, per the flow doc's
 * "one tap deep" judgment call. */
export function ActivitySheet({
  visible,
  loading,
  errorText,
  onClose,
  onSubmit,
}: ActivitySheetProps) {
  const [activityType, setActivityType] = useState<ActivityType | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const wasVisible = useRef(visible);

  const handleClose = () => {
    setActivityType(null);
    setDurationMinutes(null);
    onClose();
  };

  // The sheet is permanently mounted (`<Modal visible={sheetOpen}>`), so
  // its chip selection survives across opens unless explicitly cleared.
  // `handleClose` only covers the backdrop-tap path — a successful submit
  // closes the sheet from the parent (visible: true -> false) without
  // going through `handleClose`, so without this the previous
  // activity/duration would still look selected on next open.
  useEffect(() => {
    if (wasVisible.current && !visible) {
      setActivityType(null);
      setDurationMinutes(null);
    }
    wasVisible.current = visible;
  }, [visible]);

  const canSubmit = activityType !== null && durationMinutes !== null && !loading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Vad tränade du?</Text>

        <View style={styles.chipRow}>
          {ACTIVITIES.map((option) => {
            const selected = option.activityType === activityType;
            return (
              <Pressable
                key={option.activityType}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setActivityType(option.activityType)}
                style={[styles.activityChip, selected && styles.chipSelected]}
              >
                <Text style={styles.chipEmoji}>{option.emoji}</Text>
                <Text style={styles.chipLabel}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {activityType ? (
          <>
            <Text style={styles.subheading}>Hur länge?</Text>
            <View style={styles.chipRow}>
              {DURATIONS.map((option) => {
                const selected = option.minutes === durationMinutes;
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setDurationMinutes(option.minutes)}
                    style={[styles.durationChip, selected && styles.chipSelected]}
                  >
                    <Text style={styles.chipLabel}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

        <PrimaryButton
          label="Klart!"
          disabled={!canSubmit}
          loading={loading}
          onPress={() => {
            if (activityType && durationMinutes !== null) {
              onSubmit(activityType, durationMinutes);
            }
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,27,58,0.35)',
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 18,
    color: colors.ink,
    textAlign: 'center',
  },
  subheading: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  activityChip: {
    width: '47%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  durationChip: {
    minWidth: '22%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 12,
    alignItems: 'center',
  },
  chipSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
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
  error: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
    textAlign: 'center',
  },
});
