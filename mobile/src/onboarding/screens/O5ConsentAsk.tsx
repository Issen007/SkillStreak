import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
  const [parentContact, setParentContact] = useState(initialParentContact);

  return (
    <ScreenContainer scroll>
      <View style={styles.spacerTop} />
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.heading}>
        {isSelfVerification ? 'Verifiera ditt konto' : 'Vi frågar en vuxen om lov'}
      </Text>
      <Text style={styles.body}>
        {isSelfVerification
          ? 'Innan du kan börja logga träningar behöver du verifiera din e-post eller ditt mobilnummer.'
          : 'Innan du kan börja logga träningar behöver en förälder eller vårdnadshavare säga ja.'}
      </Text>
      <Text style={styles.body}>
        {isSelfVerification
          ? 'Vi skickar en verifieringslänk — du bekräftar med ett klick.'
          : 'Vi skickar dem en snabb fråga — de godkänner med ett klick.'}
      </Text>

      <TextField
        label={
          isSelfVerification
            ? 'Din e-post eller mobilnummer'
            : 'Förälders eller vårdnadshavares e-post eller mobilnummer'
        }
        value={parentContact}
        onChangeText={setParentContact}
        placeholder="t.ex. namn@exempel.se"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        errorText={errorText ?? undefined}
      />
      <Text style={styles.helper}>
        {isSelfVerification
          ? 'Vi använder det bara för att verifiera ditt konto — inget annat.'
          : 'Vi använder det bara för att fråga om lov — inget annat.'}
      </Text>

      <View style={styles.spacer} />

      <PrimaryButton
        label="Skicka förfrågan"
        disabled={parentContact.trim().length === 0}
        loading={loading}
        onPress={() => onSubmit(parentContact.trim())}
      />

      <Text style={styles.coachNote}>
        Tränare: hjälp spelaren fylla i om de är osäkra på uppgifterna.
      </Text>
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
