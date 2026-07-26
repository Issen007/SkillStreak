import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

// Mirrors the backend's sane range check (CreatePlayerDto) so the client
// never offers a value that would 400 — year only, never a full DOB, per
// ADR-0002. Both bounds are rolling offsets from the current year, not
// fixed calendar years, so this needs no manual update as time passes —
// see create-player.dto.ts's identical comment for why a fixed year drifts.
const OLDEST_ALLOWED_AGE_YEARS = 26;
const YOUNGEST_ALLOWED_AGE_YEARS = 4;
const MIN_BIRTH_YEAR = new Date().getFullYear() - OLDEST_ALLOWED_AGE_YEARS;
const MAX_BIRTH_YEAR = new Date().getFullYear() - YOUNGEST_ALLOWED_AGE_YEARS;

// Most-recent-first (youngest-allowed year at the top) — a kid scrolling
// this is almost always closer to the young end than the old end, so that's
// the shorter scroll from the picker's default open position.
const YEARS = Array.from(
  { length: MAX_BIRTH_YEAR - MIN_BIRTH_YEAR + 1 },
  (_, i) => MAX_BIRTH_YEAR - i,
);

interface O4BirthYearProps {
  initialBirthYear: number | null;
  /** Set when arriving here after a 400 validation error from O5 —
   * defense-in-depth for if the backend's accepted birth-year range ever
   * differs from this screen's client-side range check. */
  externalError?: string | null;
  onNext: (birthYear: number) => void;
}

export function O4BirthYear({ initialBirthYear, externalError, onNext }: O4BirthYearProps) {
  const [birthYear, setBirthYear] = useState<number | null>(initialBirthYear);
  const [error, setError] = useState<string | null>(externalError ?? null);
  const [yearText, setYearText] = useState<string>(
    initialBirthYear !== null ? String(initialBirthYear) : '',
  );

  // @react-native-picker/picker's web implementation renders a bare HTML
  // <select> under the hood, whose open dropdown list is styled by the
  // OS/browser rather than itemStyle/style here (the exact same limitation
  // site/index.html's own birth-year field had before it switched away
  // from a <select> — see that file's matching comment). Native iOS/Android
  // keep the wheel picker, a well-understood idiomatic control there; web
  // gets the same large/bold text-input treatment as the marketing site's
  // wizard instead, typed and validated against the same bounds.
  const isWeb = Platform.OS === 'web';

  const handleWebChange = (text: string) => {
    setYearText(text);
    const year = /^[0-9]{4}$/.test(text) ? parseInt(text, 10) : NaN;
    const valid = !isNaN(year) && year >= MIN_BIRTH_YEAR && year <= MAX_BIRTH_YEAR;
    setBirthYear(valid ? year : null);
    setError(
      text && !valid
        ? `Ange ett år mellan ${MIN_BIRTH_YEAR} och ${MAX_BIRTH_YEAR}.`
        : null,
    );
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>Vilket år är du född?</Text>
      <Text style={styles.sub}>
        Vi använder det för att anpassa utmaningar till din ålder.
      </Text>

      {!isWeb && error ? <Text style={styles.error}>{error}</Text> : null}

      {isWeb ? (
        <TextField
          label="Födelseår"
          value={yearText}
          onChangeText={handleWebChange}
          placeholder={`T.ex. ${MAX_BIRTH_YEAR}`}
          keyboardType="number-pad"
          maxLength={4}
          errorText={error ?? undefined}
          style={styles.webInput}
        />
      ) : (
        <View style={styles.pickerWrap}>
          <Picker
            selectedValue={birthYear ?? YEARS[0]}
            onValueChange={(year) => {
              setBirthYear(year);
              if (error) setError(null);
            }}
            style={styles.picker}
            itemStyle={styles.pickerItem}
          >
            {YEARS.map((year) => (
              <Picker.Item key={year} label={String(year)} value={year} />
            ))}
          </Picker>
        </View>
      )}

      <View style={styles.spacer} />

      <PrimaryButton
        label="Nästa"
        disabled={birthYear === null}
        onPress={() => {
          if (birthYear !== null) onNext(birthYear);
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { height: 24 },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
    textAlign: 'center',
  },
  webInput: {
    fontSize: 20,
    fontFamily: fonts.bodyBold,
    textAlign: 'center',
    paddingVertical: 16,
  },
  pickerWrap: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  picker: {
    width: '100%',
  },
  pickerItem: {
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    color: colors.ink,
  },
});
