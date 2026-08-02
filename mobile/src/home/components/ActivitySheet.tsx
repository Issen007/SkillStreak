import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ActivityType } from '../../api/types';

interface ActivityOption {
  activityType: ActivityType;
  emoji: string;
  labelKey: 'fitness' | 'drill' | 'running' | 'other';
}

const ACTIVITIES: ActivityOption[] = [
  { activityType: 'fitness', emoji: '🏋️', labelKey: 'fitness' },
  { activityType: 'drill', emoji: '🏑', labelKey: 'drill' },
  { activityType: 'running', emoji: '🏃', labelKey: 'running' },
  { activityType: 'other', emoji: '⭐', labelKey: 'other' },
];

const DURATIONS: { labelKey: 'd10' | 'd15' | 'd20' | 'd30plus'; minutes: number }[] = [
  { labelKey: 'd10', minutes: 10 },
  { labelKey: 'd15', minutes: 15 },
  { labelKey: 'd20', minutes: 20 },
  { labelKey: 'd30plus', minutes: 30 },
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
  const { t } = useTranslation('home');
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
        <Text style={styles.heading}>{t('activitySheet.heading')}</Text>

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
                <Text style={styles.chipLabel}>{t(`activitySheet.activities.${option.labelKey}`)}</Text>
              </Pressable>
            );
          })}
        </View>

        {activityType ? (
          <>
            <Text style={styles.subheading}>{t('activitySheet.durationHeading')}</Text>
            <View style={styles.chipRow}>
              {DURATIONS.map((option) => {
                const selected = option.minutes === durationMinutes;
                return (
                  <Pressable
                    key={option.labelKey}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setDurationMinutes(option.minutes)}
                    style={[styles.durationChip, selected && styles.chipSelected]}
                  >
                    <Text style={styles.chipLabel}>{t(`activitySheet.durations.${option.labelKey}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

        <PrimaryButton
          label={t('activitySheet.submit')}
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
