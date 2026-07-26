import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ClipIntroCardProps {
  onDismiss: () => void;
}

/** Screen V0 — "Så funkar Klipp", the one-time first-open guardrail. Shown
 * once, the first time a player ever opens the Klipp tab — same mechanism
 * as CH0, and (per the flow doc) shown regardless of `consentStatus`: the
 * guardrails are worth knowing before a kid even learns *why* upload might
 * be locked, not gated behind approval themselves. */
export function ClipIntroCard({ onDismiss }: ClipIntroCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Så funkar Shorts</Text>
        <Text style={styles.bullet}>• Bara ditt eget lag ser Shorts-videorna som laddas upp här.</Text>
        <Text style={styles.bullet}>
          • En förälder eller vårdnadshavare måste säga ja innan du kan ladda upp en Shorts
          själv.
        </Text>
        <Text style={styles.bullet}>
          • Känns en Shorts fel? Rapportera den så försvinner den direkt för hela laget, medan en
          vuxen tittar på den.
        </Text>
        <Text style={styles.bullet}>• Du kan alltid ta bort dina egna Shorts, när du vill.</Text>
        <PrimaryButton label="Okej, jag fattar!" onPress={onDismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 19,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 4,
  },
  bullet: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.textBody,
    lineHeight: 19,
  },
});
