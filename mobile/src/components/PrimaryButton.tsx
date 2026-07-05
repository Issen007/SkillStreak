import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/** Solid `ink`-filled CTA — originally "every primary onboarding action",
 * now also reused as-is for Phase 2's captain actions (e.g. GoalScreen's
 * "Aktivera nu"/"+ Sätt veckans mål", KB4Review's "Aktivera nu") since
 * those needed the exact same visual weight, not a new variant. (The home
 * screen's flame-filled "Jag har tränat" button is its own component since
 * its disabled/restyled states are more specific — see `TrainedButton`.) */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: PrimaryButtonProps) {
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
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={[styles.label, isDisabled && styles.labelDisabled]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.ink,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: colors.disabledBg,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.white,
    textAlign: 'center',
  },
  labelDisabled: {
    color: colors.disabledText,
  },
});
