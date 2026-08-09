import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * A plain two-choice confirmation sheet, in the app's ordinary register.
 *
 * Deliberately **not** `DangerButton`'s red treatment, which this app
 * reserves for genuinely irreversible destruction (clip deletion hard-
 * deletes the object from storage). Fas 8's two confirmations — a player
 * ending a PT relationship, a captain removing a PT — are both reversible:
 * the relationship can be requested and approved again. Dressing them as
 * destructive would discourage exactly the children most likely to need
 * the first one.
 *
 * Extracted here rather than written twice because PL1 and CAP1 need the
 * identical shape with different copy; `ClipDeleteSheet` stays its own
 * component precisely because its red styling is a different decision.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  cancelLabel,
  confirmLabel,
  loading = false,
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onCancel} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <View style={styles.actions}>
          <SecondaryButton label={cancelLabel} onPress={onCancel} disabled={loading} />
          <PrimaryButton label={confirmLabel} onPress={onConfirm} loading={loading} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    marginTop: 'auto',
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 22,
    gap: 10,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 18,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textBody,
  },
  actions: {
    gap: 10,
    marginTop: 6,
  },
});
