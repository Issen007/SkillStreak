import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ReminderActionSheetProps {
  visible: boolean;
  screenName: string;
  loading: boolean;
  onClose: () => void;
  onSendReminder: () => void;
}

/** Screen K2's row action sheet — deliberately just the one action
 * ("Skicka påminnelse till förälder"). The old design's second action
 * ("Visa inloggningskod") is out of scope per this task's boundary: that
 * backend route (`POST /players/:playerId/session-reissue`) is disabled
 * (503 `session_reissue_disabled`) pending a security redesign. */
export function ReminderActionSheet({
  visible,
  screenName,
  loading,
  onClose,
  onSendReminder,
}: ReminderActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{screenName}</Text>
        <PrimaryButton
          label="Skicka påminnelse till förälder"
          loading={loading}
          onPress={onSendReminder}
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
