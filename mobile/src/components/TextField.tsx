import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface TextFieldProps extends TextInputProps {
  label?: string;
  errorText?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(
  ({ label, errorText, style, ...inputProps }, ref) => {
    return (
      <View style={styles.container}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, errorText ? styles.inputError : null, style]}
          {...inputProps}
        />
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </View>
    );
  },
);
TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.body,
    backgroundColor: colors.white,
    color: colors.ink,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
  },
});
