import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

type TrainedButtonVariant = 'primary' | 'secondary' | 'disabled';

interface TrainedButtonProps {
  variant: TrainedButtonVariant;
  onPress: () => void;
}

/** The "Jag har tränat" CTA in its three documented states:
 * - `primary`   — H1, solid `flame` fill (style-guide.md: flame is the
 *                 primary CTA background).
 * - `secondary` — H3, outline treatment ("still tappable, not the main
 *                 ask anymore" per the flow doc — logging again still
 *                 adds to the team pool even though the streak is frozen
 *                 for today).
 * - `disabled`  — H4/O7, visibly present but locked, never hidden. */
export function TrainedButton({ variant, onPress }: TrainedButtonProps) {
  if (variant === 'disabled') {
    return (
      <View style={[styles.base, styles.disabled]}>
        <Text style={[styles.label, styles.disabledLabel]}>Jag har tränat 🔒</Text>
      </View>
    );
  }

  if (variant === 'secondary') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.base, styles.secondary, pressed && styles.pressed]}
      >
        <Text style={[styles.label, styles.secondaryLabel]}>Logga en till träning</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles.primary, pressed && styles.pressed]}
    >
      <Text style={[styles.label, styles.primaryLabel]}>Jag har tränat</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  primary: {
    backgroundColor: colors.flame,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  disabled: {
    backgroundColor: colors.disabledBg,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
  },
  primaryLabel: {
    color: colors.white,
  },
  secondaryLabel: {
    color: colors.ink,
  },
  disabledLabel: {
    color: colors.disabledText,
  },
});
