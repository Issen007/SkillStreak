import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ChatIntroCardProps {
  onDismiss: () => void;
}

/** Screen CH0 — the one-time, first-open guardrail explainer. A light
 * card, not a scary consent-form-style modal: the guardrails need to be
 * known before the first message is typed, not discovered by accident
 * after something goes wrong (docs/design/phase2.6-2.7-flows.md). */
export function ChatIntroCard({ onDismiss }: ChatIntroCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Så funkar lagchatten</Text>
        <Text style={styles.bullet}>• Bara ditt eget lag ser det du skriver här.</Text>
        <Text style={styles.bullet}>
          • Känns något fel? Du kan rapportera ett meddelande, eller blockera en person så du
          slipper se fler av deras meddelanden.
        </Text>
        <Text style={styles.bullet}>
          • Vissa ord funkar inte här. Om ett meddelande inte går att skicka, testa att skriva om
          det.
        </Text>
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
