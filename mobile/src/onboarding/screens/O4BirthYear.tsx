import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';

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
// Widened 2026-07-26 from 26 to 56 (matches create-player.dto.ts) — see
// that file's comment for why.
// **Kept in step with backend/src/onboarding/dto/create-player.dto.ts by
// hand, and the cost of that showed on 2026-08-31.** This is a picker, not
// a text field, so the bound is not a validation message a person can read
// — it decides which years exist to choose from. A tester born before 1970
// found his year simply absent and reported that the app said he was "too
// old". It never said that. It offered him a list that stopped short of
// him, which is worse, because there is nothing to argue with.
//
// Widened here to match the backend's 120 the same day. If these two ever
// disagree again, the app is the one a person meets: a narrower list here
// silently excludes people the server would have accepted, and a wider one
// offers a year that is then rejected after they have picked it.
const OLDEST_ALLOWED_AGE_YEARS = 120;
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
  const { t } = useTranslation('onboarding');
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
        ? t('o4.yearRangeError', { minYear: MIN_BIRTH_YEAR, maxYear: MAX_BIRTH_YEAR })
        : null,
    );
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>{t('o4.heading')}</Text>
      <Text style={styles.sub}>{t('o4.sub')}</Text>

      {!isWeb && error ? <Text style={styles.error}>{error}</Text> : null}

      {isWeb ? (
        <TextField
          label={t('o4.yearLabel')}
          value={yearText}
          onChangeText={handleWebChange}
          placeholder={t('o4.yearPlaceholder', { maxYear: MAX_BIRTH_YEAR })}
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
        label={t('o4.next')}
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
