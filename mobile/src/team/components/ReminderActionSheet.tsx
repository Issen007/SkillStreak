import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ReminderActionSheetProps {
  visible: boolean;
  screenName: string;
  loading: boolean;
  /** Independent from `loading` (the reminder action's own spinner) so
   * one button being busy doesn't grey out the other. */
  reissueLoading: boolean;
  onClose: () => void;
  onSendReminder: () => void;
  onSendReissue: () => void;
}

/** Screen K2's row action sheet. "Skicka ny inloggningslänk" (docs/
 * adr/0004-coach-auth-and-session-reissue.md's 2026-07-27 addendum) was
 * out of scope until that redesign shipped — the route was disabled
 * (503 `session_reissue_disabled`) before then. Both actions are shown
 * unconditionally (no client-side consent-status gating), matching this
 * screen's existing pattern of letting the backend reject a not-applicable
 * action (e.g. `consent_not_pending`) rather than guessing client-side. */
export function ReminderActionSheet({
  visible,
  screenName,
  loading,
  reissueLoading,
  onClose,
  onSendReminder,
  onSendReissue,
}: ReminderActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={loading || reissueLoading ? undefined : onClose}
      />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{screenName}</Text>
        <PrimaryButton
          label="Skicka påminnelse till förälder"
          loading={loading}
          disabled={reissueLoading}
          onPress={onSendReminder}
        />
        <PrimaryButton
          label="Skicka ny inloggningslänk"
          loading={reissueLoading}
          disabled={loading}
          onPress={onSendReissue}
        />
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
});
