import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/** Low-emphasis bordered action — e.g. Screen G1's "Avbryt målet" ("a
 * secondary, low-emphasis button" per the flow doc) and Screen KB4's
 * "Spara som utkast". Visually subordinate to a screen's primary CTA
 * without disappearing into a text-only `SecondaryLink`. Mirrors
 * `TrainedButton`'s existing outline treatment rather than inventing a new
 * visual language for the same idea. */
export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: SecondaryButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <Text style={[styles.label, isDisabled && styles.labelDisabled]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.ink,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    borderColor: colors.disabledBg,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
  },
  labelDisabled: {
    color: colors.disabledText,
  },
});
