import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { DangerButton } from '../../components/DangerButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ErasureConfirmSheetProps {
  visible: boolean;
  successorScreenName: string | null;
  loading: boolean;
  errorText: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Screen E4 — "Är du säker?" A `Modal` overlay on top of E2 (the same
 * `visible`-prop-driven pattern `ClipDeleteSheet` already uses), styled
 * with `DangerButton` even though this tap alone isn't instantly,
 * unconditionally permanent (Judgment call 2) — email confirmation still
 * gates the 30-day clock, and cancellation stays available throughout, but
 * this is still the single most consequential action in the app. */
export function ErasureConfirmSheet({
  visible,
  successorScreenName,
  loading,
  errorText,
  onConfirm,
  onClose,
}: ErasureConfirmSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Är du säker?</Text>
        <Text style={styles.body}>
          Vi skickar ett mejl som måste bekräftas för att sätta igång de 30 dagarna. Ångrar du dig
          kan du avbryta när som helst innan de gått ut.
        </Text>
        {successorScreenName ? (
          <Text style={styles.successorBody}>
            {successorScreenName} tar över som kapten den dag kontot raderas.
          </Text>
        ) : null}
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        <DangerButton label="Ja, radera mitt konto" loading={loading} onPress={onConfirm} />
        <SecondaryLink label="Avbryt" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,27,58,0.35)',
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 18,
  },
  successorBody: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
    textAlign: 'center',
  },
});
