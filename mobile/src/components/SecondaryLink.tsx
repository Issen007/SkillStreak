import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface SecondaryLinkProps {
  label: string;
  onPress: () => void;
}

/** Low-visual-weight, text-style secondary action (e.g. O2's "Nej, testa
 * en annan kod") — deliberately not a bordered button, so it never
 * competes with the primary CTA. */
export function SecondaryLink({ label, onPress }: SecondaryLinkProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
