import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface DangerButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/** This app's reserved destructive/red button — solid `error` fill, white
 * text, matching `docs/design/phase3-mockup.html`'s `.btn-destructive`
 * exactly. Every other "are you sure" moment built so far (K4's captain
 * transfer, CH4's block, G1's "Avbryt målet") deliberately avoids this
 * treatment, since none of those actions is genuinely, unconditionally
 * permanent (see `CaptainTransferConfirmSheet`'s own comment). Screen V11's
 * clip self-delete is the first action in this app that actually is —
 * hard-deleted from storage, no undo — so this is the first real use of
 * this component, not a new visual language invented for its own sake (per
 * docs/design/phase3-flows.md's judgment call 10). Reach for this only for
 * an equally genuinely-irreversible action, not any "are you sure" sheet. */
export function DangerButton({ label, onPress, disabled = false, loading = false }: DangerButtonProps) {
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
        <Text style={[styles.label, isDisabled && styles.labelDisabled]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.error,
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
