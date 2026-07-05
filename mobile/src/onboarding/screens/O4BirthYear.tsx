import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

// Mirrors the backend's sane range check (CreatePlayerDto) so the client
// never offers a value that would 400 — year only, never a full DOB, per
// ADR-0002.
const MIN_BIRTH_YEAR = 2000;
const MAX_BIRTH_YEAR = new Date().getFullYear();

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

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>Vilket år är du född?</Text>
      <Text style={styles.sub}>
        Vi använder det för att anpassa utmaningar till din ålder.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.grid}>
        {YEARS.map((year) => {
          const selected = year === birthYear;
          return (
            <Pressable
              key={year}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                setBirthYear(year);
                if (error) setError(null);
              }}
              style={[styles.yearCell, selected && styles.yearCellSelected]}
            >
              <Text style={[styles.yearText, selected && styles.yearTextSelected]}>
                {year}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  yearCell: {
    width: '30%',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  yearCellSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  yearText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
  },
  yearTextSelected: {
    color: colors.ink,
  },
});
