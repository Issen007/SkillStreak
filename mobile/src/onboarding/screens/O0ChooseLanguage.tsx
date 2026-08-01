import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { LOCALE_CATALOG } from '../../i18n/localeCatalog';
import i18n from '../../i18n';
import type { PlayerLocale } from '../../api/types';

interface O0ChooseLanguageProps {
  /** The device-guessed default (see `i18n/deviceLocale.ts`) — only ever a
   * pre-selected starting point, never submitted without the player
   * reaching this screen and tapping "Nästa"/"Next" themselves. */
  initialLocale: PlayerLocale;
  onNext: (locale: PlayerLocale) => void;
}

/** Screen O0 (docs/adr/0014-multi-language-support.md Decision 2) — new
 * first onboarding screen, before O1EnterCode. Has to be first, not folded
 * in later: every subsequent onboarding screen's copy needs to render in
 * whatever the player just picked. Selecting a row calls
 * `i18n.changeLanguage` synchronously (not deferred to "Nästa") so the
 * round-trip is real immediately, not just on submit — matching the ADR's
 * "sets i18next's active language synchronously on selection" decision. */
export function O0ChooseLanguage({ initialLocale, onNext }: O0ChooseLanguageProps) {
  const { t } = useTranslation('onboarding');
  const [selected, setSelected] = useState<PlayerLocale>(initialLocale);

  const handleSelect = (code: PlayerLocale) => {
    setSelected(code);
    void i18n.changeLanguage(code);
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.heading}>{t('o0.heading')}</Text>
      <Text style={styles.sub}>{t('o0.sub')}</Text>

      <View style={styles.list}>
        {LOCALE_CATALOG.map((option) => {
          const isSelected = option.code === selected;
          return (
            <Pressable
              key={option.code}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => handleSelect(option.code)}
              style={[styles.row, isSelected && styles.rowSelected]}
            >
              <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>
                {option.label}
              </Text>
              {isSelected ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.spacer} />

      <PrimaryButton label={t('o0.next')} onPress={() => onNext(selected)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 32 },
  spacer: { flex: 1, minHeight: 24 },
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
  list: {
    gap: 10,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  rowSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  rowLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.ink,
  },
  rowLabelSelected: {
    color: colors.ink,
  },
  check: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.flame,
  },
});
