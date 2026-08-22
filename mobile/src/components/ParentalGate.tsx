import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from './PrimaryButton';
import { SecondaryLink } from './SecondaryLink';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

/**
 * The parental gate Apple's Kids Category requires in front of anything
 * that leaves the app (App Review 1.3) — project owner chose that category
 * on 2026-08-22.
 *
 * **This is a compliance control, not a security one, and the difference
 * is worth stating rather than glossing.** This app's users are 9–13. A
 * thirteen-year-old can do arithmetic; nothing rendered on their own phone
 * will genuinely stop them. What a gate does is make leaving the app a
 * deliberate act rather than an accidental tap, and give a parent standing
 * to have set the expectation. Pretending otherwise would be the kind of
 * claim this codebase avoids elsewhere.
 *
 * Given that, the sum is chosen to be awkward rather than impossible:
 * a two-digit number times a single digit, never a times-table fact a
 * nine-year-old has memorised (no ×1, ×2, ×5, ×10, and never a repeated
 * operand). Free numeric entry, not multiple choice — Apple has rejected
 * gates a child can beat by tapping every option.
 *
 * Randomised per open, so it cannot be learned by repetition.
 */

function makeChallenge(): { a: number; b: number; answer: number } {
  // 12–39 keeps it two-digit and off the easy end of the tables.
  const a = 12 + Math.floor(Math.random() * 28);
  // 3,4,6,7,8,9 — the multipliers a young child is least fluent with.
  const b = [3, 4, 6, 7, 8, 9][Math.floor(Math.random() * 6)];
  return { a, b, answer: a * b };
}

export function ParentalGate({
  visible,
  onPass,
  onClose,
}: {
  visible: boolean;
  onPass: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [entry, setEntry] = useState('');
  const [wrong, setWrong] = useState(false);
  // Held in state rather than memoised: a new sum is wanted on *events*
  // (the sheet opening, a wrong answer), which is not what useMemo means,
  // and writing it that way needed dependencies the callback never reads.
  const [challenge, setChallenge] = useState(makeChallenge);

  useEffect(() => {
    if (visible) setChallenge(makeChallenge());
  }, [visible]);

  const submit = () => {
    if (Number(entry.trim()) === challenge.answer) {
      setEntry('');
      setWrong(false);
      onPass();
      return;
    }
    setWrong(true);
    setEntry('');
    setChallenge(makeChallenge());
  };

  const dismiss = () => {
    setEntry('');
    setWrong(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{t('parentalGate.heading')}</Text>
        <Text style={styles.body}>{t('parentalGate.body')}</Text>

        <Text style={styles.sum}>{`${challenge.a} × ${challenge.b} = ?`}</Text>
        <TextInput
          style={styles.input}
          value={entry}
          onChangeText={setEntry}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={4}
          accessibilityLabel={t('parentalGate.inputLabel')}
          onSubmitEditing={submit}
          returnKeyType="done"
        />
        {wrong ? <Text style={styles.wrong}>{t('parentalGate.wrong')}</Text> : null}

        <PrimaryButton label={t('parentalGate.confirm')} onPress={submit} />
        <SecondaryLink label={t('parentalGate.cancel')} onPress={dismiss} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(27,27,58,0.35)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 28,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 17,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textBody,
    textAlign: 'center',
  },
  sum: {
    fontFamily: fonts.headingBold,
    fontSize: 26,
    color: colors.ink,
    textAlign: 'center',
    marginTop: 4,
  },
  input: {
    alignSelf: 'center',
    minWidth: 120,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    textAlign: 'center',
    color: colors.ink,
  },
  wrong: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
});
