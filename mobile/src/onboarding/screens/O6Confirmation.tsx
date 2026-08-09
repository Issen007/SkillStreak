import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O6ConfirmationProps {
  screenName: string;
  teamName: string;
  /** Built strictly off the `201` response's `teamCreated`/`isCaptain`
   * fields — never off which UI path (O1a vs O2) the player took to
   * get here. See the flow doc's O6 "Edge case" callout: a player who
   * confirmed "create" at O1a can still legitimately land on the ordinary
   * `teamCreated: false` variant with zero error shown, if another
   * request won a race for the same invite code first. `isCaptain` is
   * always `true` whenever `teamCreated` is `true`, per the contract, but
   * both are threaded through (rather than inferring one from the other)
   * to match how the response itself is shaped. */
  teamCreated: boolean;
  isCaptain: boolean;
  /** Only shown in the `teamCreated: true` variant — the founding
   * captain's one durable, in-app reminder of the code they need to
   * recruit teammates with. */
  inviteCode: string;
  onDone: () => void;
}

export function O6Confirmation({
  screenName,
  teamName,
  teamCreated,
  isCaptain,
  inviteCode,
  onDone,
}: O6ConfirmationProps) {
  // teamCreated implies isCaptain per the contract (ADR-0009's response
  // addendum) — both are checked so this reads correctly even if a future
  // response ever decoupled them.
  const isFoundingCaptain = teamCreated && isCaptain;
  const { t } = useTranslation('onboarding');

  return (
    <ScreenContainer>
      <View style={styles.spacerTop} />
      {isFoundingCaptain ? (
        <>
          <Text style={styles.icon}>{t('o6.foundingIcon')}</Text>
          <Text style={styles.heading}>
            {t('o6.foundingHeading', { screenName, teamName })}
          </Text>
          <Text style={styles.body}>{t('o6.foundingBody')}</Text>
          <View style={styles.codeChipWrap}>
            <Text style={styles.codeChip}>{t('o6.codeChip', { inviteCode })}</Text>
          </View>
          <Text style={styles.codeHelper}>{t('o6.codeHelper')}</Text>
        </>
      ) : (
        <>
          <Text style={styles.icon}>{t('o6.joinedIcon')}</Text>
          <Text style={styles.heading}>{t('o6.joinedHeading', { screenName })}</Text>
          <Text style={styles.body}>{t('o6.joinedBody', { teamName })}</Text>
        </>
      )}

      <View style={styles.spacer} />

      <PrimaryButton label={t('o6.doneButton')} onPress={onDone} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 32 },
  spacer: { flex: 1, minHeight: 24 },
  icon: {
    fontSize: 40,
    textAlign: 'center',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 21,
  },
  codeChipWrap: {
    alignItems: 'center',
    marginTop: 4,
  },
  codeChip: {
    fontFamily: 'Courier New',
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.border,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  codeHelper: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
