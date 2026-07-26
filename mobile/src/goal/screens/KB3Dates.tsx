import { createElement, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface KB3Props {
  initialStartDate: string;
  initialEndDate: string;
  onNext: (startDate: string, endDate: string) => void;
  onBack: () => void;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatDisplayDate(iso: string): string {
  if (!ISO_DATE_PATTERN.test(iso)) return iso;
  return parseIsoDate(iso).toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** Tapping the field opens a real calendar to pick a day from, instead of
 * typing "ÅÅÅÅ-MM-DD" by hand — per docs/design/phase2-flows.md's original
 * KB3 spec ("Two date pickers"), which this screen had deviated from since
 * no picker dependency was installed yet.
 *
 * @react-native-community/datetimepicker has no web implementation at all
 * (no `.web.js` variant, no `browser` field in its package.json) — same
 * "native module with nothing behind it on web" gap this app already hit
 * with expo-secure-store and @react-native-picker/picker. A plain HTML
 * `<input type="date">` gives web the identical "click it, a calendar pops
 * up" behavior for free, using the browser's own picker rather than a
 * third dependency. */
function DateField({ label, value, onChange }: DateFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        {createElement('input', {
          type: 'date',
          value,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          style: {
            border: `1.5px solid ${colors.border}`,
            borderRadius: 14,
            padding: '13px 14px',
            fontSize: 15,
            fontFamily: fonts.body,
            backgroundColor: colors.white,
            color: colors.ink,
            width: '100%',
            boxSizing: 'border-box',
          },
        })}
      </View>
    );
  }

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      // Android's dialog is already a self-dismissing popup — 'dismissed'
      // means the user cancelled, leave the previous value untouched.
      setPickerOpen(false);
      if (event.type === 'set' && selected) onChange(formatIsoDate(selected));
      return;
    }
    // iOS: the picker stays open (rendered inside our own Modal below)
    // until "Klar" is tapped — every change here is a live preview, not a
    // final commit.
    if (selected) onChange(formatIsoDate(selected));
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setPickerOpen(true)}
        style={styles.input}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDisplayDate(value)}`}
      >
        <Text style={styles.inputText}>{formatDisplayDate(value)}</Text>
      </Pressable>

      {Platform.OS === 'android' && pickerOpen ? (
        <DateTimePicker
          value={ISO_DATE_PATTERN.test(value) ? parseIsoDate(value) : new Date()}
          mode="date"
          display="calendar"
          onChange={handleChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={pickerOpen} transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <DateTimePicker
                value={ISO_DATE_PATTERN.test(value) ? parseIsoDate(value) : new Date()}
                mode="date"
                display="inline"
                onChange={handleChange}
              />
              <PrimaryButton label="Klar" onPress={() => setPickerOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export function KB3Dates({ initialStartDate, initialEndDate, onNext, onBack }: KB3Props) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  const bothValid = ISO_DATE_PATTERN.test(startDate) && ISO_DATE_PATTERN.test(endDate);
  const orderValid = !bothValid || endDate > startDate;
  const canSubmit = bothValid && orderValid;

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>När börjar och slutar veckans mål?</Text>

      <DateField label="Startdatum" value={startDate} onChange={setStartDate} />
      <DateField label="Slutdatum" value={endDate} onChange={setEndDate} />

      {bothValid && !orderValid ? (
        <Text style={styles.error}>Slutdatum måste vara efter startdatum.</Text>
      ) : null}

      <PrimaryButton
        label="Nästa"
        disabled={!canSubmit}
        onPress={() => onNext(startDate, endDate)}
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
  field: {
    gap: 6,
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
    backgroundColor: colors.white,
  },
  inputText: {
    fontSize: 15,
    fontFamily: fonts.bodyBold,
    color: colors.ink,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 16,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
  },
});
