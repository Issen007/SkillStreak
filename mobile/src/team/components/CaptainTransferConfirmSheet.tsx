import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface CaptainTransferConfirmSheetProps {
  visible: boolean;
  screenName: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Screen K4's confirm sheet — same bottom-sheet pattern as
 * `ReminderActionSheet`. Deliberately styled as an ordinary *positive*
 * action (`PrimaryButton`'s normal `ink` fill), explicitly not the
 * red/destructive treatment this app reserves for things like "Avbryt
 * målet" — handing off captaincy is a normal, positive team-management
 * moment, per docs/design/phase2.6-2.7-flows.md's judgment call 4. */
export function CaptainTransferConfirmSheet({
  visible,
  screenName,
  loading,
  onConfirm,
  onClose,
}: CaptainTransferConfirmSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Gör {screenName} till kapten?</Text>
        <Text style={styles.body}>
          {screenName} får kaptensknapparna direkt. Du är fortfarande med i laget som vanligt —
          och om {screenName} vill kan de alltid lämna tillbaka det till dig sen, precis som du
          gör nu.
        </Text>
        <PrimaryButton
          label={`Ja, gör ${screenName} till kapten`}
          loading={loading}
          onPress={onConfirm}
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
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 18,
  },
});
