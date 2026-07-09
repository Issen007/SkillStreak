import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface BlockSheetProps {
  visible: boolean;
  screenName: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Screen CH4 — "Om {screenName}" (block). Reached only from a live
 * message in CH1 (or CH3's follow-up), so this sheet can only ever offer
 * "Blockera," never "Sluta blockera" (see Screen CH5 for the reverse).
 * "Blockera" is styled as an ordinary secondary action, not a red/
 * destructive one — a personal, protective tool, not a punitive one, per
 * the flow doc's judgment call 9. */
export function BlockSheet({ visible, screenName, loading, onConfirm, onClose }: BlockSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{screenName}</Text>
        <Text style={styles.body}>
          Om du blockerar {screenName} slutar du se deras meddelanden i lagchatten. {screenName}{' '}
          får inte veta att du har blockerat dem.
        </Text>
        <SecondaryButton label={`Blockera ${screenName}`} loading={loading} onPress={onConfirm} />
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
