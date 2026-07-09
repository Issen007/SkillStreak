import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

const MAX_LENGTH = 500;
const COUNTER_THRESHOLD = 400;

interface ComposeBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** `403 consent_required` — a player whose parent hasn't approved yet.
   * The compose box stays visible but locked, same "don't hide the
   * feature, show it disabled" rule Phase 1's `TrainedButton` already
   * established for the same situation. */
  locked: boolean;
  /** `422 message_rejected_by_filter` inline error — typed text stays in
   * the input per the contract's explicit instruction, nothing is
   * cleared. */
  filterErrorText: string | null;
}

/** Screen CH1's bottom-fixed compose box. */
export function ComposeBar({
  value,
  onChangeText,
  onSend,
  sending,
  locked,
  filterErrorText,
}: ComposeBarProps) {
  const trimmed = value.trim();
  const overLimit = value.length > MAX_LENGTH;
  const canSend = !locked && !sending && trimmed.length > 0 && !overLimit;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Skriv något till laget…"
          placeholderTextColor={colors.textMuted}
          editable={!locked && !sending}
          multiline
          maxLength={MAX_LENGTH + 20}
          style={[styles.input, locked && styles.inputLocked]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          onPress={canSend ? onSend : undefined}
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        >
          <Text style={styles.sendIcon}>{locked ? '🔒' : '➤'}</Text>
        </Pressable>
      </View>

      {value.length > COUNTER_THRESHOLD ? (
        <Text style={[styles.counter, overLimit && styles.counterOver]}>
          {value.length}/{MAX_LENGTH}
        </Text>
      ) : null}

      {locked ? (
        <Text style={styles.lockedNote}>
          Väntar på godkännande innan du kan skicka meddelanden. Du kan fortfarande läsa vad laget
          skriver.
        </Text>
      ) : null}

      {filterErrorText ? <Text style={styles.filterError}>{filterErrorText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 4,
  },
  bar: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    maxHeight: 90,
  },
  inputLocked: {
    color: colors.disabledText,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.flame,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.disabledBg,
  },
  sendIcon: {
    fontSize: 16,
    color: colors.white,
  },
  counter: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  counterOver: {
    color: colors.error,
  },
  lockedNote: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 15,
  },
  filterError: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.error,
    lineHeight: 15,
  },
});
