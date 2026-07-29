import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface SecondaryLinkProps {
  label: string;
  onPress: () => void;
  /** Fas 4.2 (docs/design/phase4.2-account-erasure-flows.md, Judgment call
   * 1) — Screen E1's "Radera mitt konto" entry point is a plain
   * `SecondaryLink` except its text is `colors.error`, not a full
   * `DangerButton`: a small severity cue proportionate to "this just opens
   * a screen and does nothing durable," not to the actual destructive tap
   * itself (which lives behind a later confirm step). Defaults to `'muted'`
   * so every existing call site is unaffected. */
  variant?: 'muted' | 'error';
}

/** Low-visual-weight, text-style secondary action (e.g. O2's "Nej, testa
 * en annan kod") — deliberately not a bordered button, so it never
 * competes with the primary CTA. */
export function SecondaryLink({ label, onPress, variant = 'muted' }: SecondaryLinkProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={[styles.label, variant === 'error' && styles.labelError]}>{label}</Text>
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
  labelError: {
    color: colors.error,
  },
});
