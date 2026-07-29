import { ScrollView, StyleSheet, Text } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ErasureCheckEmailScreenProps {
  onDone: () => void;
}

/** Screen E5 — "Kolla inkorgen", shown once after a successful `201` from
 * E4. Deliberately has no code-input field, unlike `confirmChange`'s
 * screen it otherwise most resembles in shape — per ADR Decision 3,
 * `POST /players/erasure-confirm/:code` is unauthenticated (a mailed
 * link, opened from any device), not a typed-back code (Judgment call 5).
 * No "fick du inget mejl, skicka igen" link either — whether re-submitting
 * the request while one is already active resends the email isn't settled
 * by the ADR, so this screen doesn't guess at that behavior. */
export function ErasureCheckEmailScreen({ onDone }: ErasureCheckEmailScreenProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.icon}>📩</Text>
      <Text style={styles.heading}>Kolla inkorgen</Text>
      <Text style={styles.body}>
        Vi har skickat ett mejl med en länk. Öppna mejlet och tryck på länken för att sätta igång
        de 30 dagarna — det går bra att vänta och göra det imorgon också.
      </Text>
      <Text style={styles.mutedBody}>
        Trycker du inte på länken händer ingenting — kontot är kvar precis som vanligt.
      </Text>
      <PrimaryButton label="Till profilen" onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 32,
    gap: 14,
  },
  icon: {
    fontSize: 32,
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
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 20,
  },
  mutedBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
});
