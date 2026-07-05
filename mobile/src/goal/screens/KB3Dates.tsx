import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

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

// No native date-picker dependency is installed in this app (no
// @react-native-community/datetimepicker or similar) — rather than add one
// for this single, captain-only, low-frequency screen, this uses plain
// labeled text inputs pre-filled with sane defaults (today / +7 days, set
// by the caller) plus the exact inline validation copy the flow doc
// specifies. Flagged as a deviation from "two date pickers" in the report.
export function KB3Dates({ initialStartDate, initialEndDate, onNext, onBack }: KB3Props) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  const bothValid = ISO_DATE_PATTERN.test(startDate) && ISO_DATE_PATTERN.test(endDate);
  const orderValid = !bothValid || endDate > startDate;
  const canSubmit = bothValid && orderValid;

  return (
    <ScreenContainer scroll>
      <Text style={styles.heading}>När börjar och slutar veckans mål?</Text>

      <Text style={styles.label}>Startdatum</Text>
      <TextInput
        placeholder="ÅÅÅÅ-MM-DD"
        placeholderTextColor={colors.textMuted}
        value={startDate}
        onChangeText={setStartDate}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Slutdatum</Text>
      <TextInput
        placeholder="ÅÅÅÅ-MM-DD"
        placeholderTextColor={colors.textMuted}
        value={endDate}
        onChangeText={setEndDate}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />

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
  error: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
  },
});
