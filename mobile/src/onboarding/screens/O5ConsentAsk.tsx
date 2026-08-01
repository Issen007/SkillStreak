import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextField } from '../../components/TextField';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O5ConsentAskProps {
  initialParentContact: string;
  /** Age-banded self-verification (13+) — added 2026-07-27. Same rolling
   * threshold as the backend's isSelfVerificationAge (13, Sweden's actual
   * GDPR Art. 8 digital-consent age via Dataskyddslagen 2018:218 Ch.2§4),
   * computed here purely for copy — the backend independently re-derives
   * and enforces this itself from birthYear, this prop can never bypass
   * anything. */
  isSelfVerification: boolean;
  loading: boolean;
  errorText?: string | null;
  onSubmit: (parentContact: string) => void;
}

export function O5ConsentAsk({
  initialParentContact,
  isSelfVerification,
  loading,
  errorText,
  onSubmit,
}: O5ConsentAskProps) {
  const { t } = useTranslation('onboarding');
  const [parentContact, setParentContact] = useState(initialParentContact);

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.heading}>
        {isSelfVerification ? t('o5.verifyHeading') : t('o5.consentHeading')}
      </Text>
      <Text style={styles.body}>
        {isSelfVerification ? t('o5.verifyBody1') : t('o5.consentBody1')}
      </Text>
      <Text style={styles.body}>
        {isSelfVerification ? t('o5.verifyBody2') : t('o5.consentBody2')}
      </Text>

      <TextField
        label={isSelfVerification ? t('o5.verifyContactLabel') : t('o5.consentContactLabel')}
        value={parentContact}
        onChangeText={setParentContact}
        placeholder={t('o5.contactPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        errorText={errorText ?? undefined}
      />
      <Text style={styles.helper}>
        {isSelfVerification ? t('o5.verifyHelper') : t('o5.consentHelper')}
      </Text>

      <View style={styles.spacer} />

      <PrimaryButton
        label={t('o5.submit')}
        disabled={parentContact.trim().length === 0}
        loading={loading}
        onPress={() => onSubmit(parentContact.trim())}
      />

      <Text style={styles.coachNote}>{t('o5.coachNote')}</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 8 },
  spacer: { height: 24 },
  icon: {
    fontSize: 34,
    textAlign: 'center',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 19,
  },
  helper: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  coachNote: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderStyle: 'dashed',
  },
});
