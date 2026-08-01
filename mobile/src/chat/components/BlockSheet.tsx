import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

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
 * the flow doc's judgment call 9.
 *
 * Copy updated for Fas 3 (docs/design/phase3-flows.md's "does blocking a
 * teammate in chat also hide their clips?" decision): a `TeamChatBlock` is
 * one per-viewer "I don't want to see this person" preference spanning both
 * chat *and* the Klipp feed, not two independent settings — this body copy
 * needs to say so, since it previously only mentioned messages and would
 * now understate what blocking actually does. */
export function BlockSheet({ visible, screenName, loading, onConfirm, onClose }: BlockSheetProps) {
  const { t } = useTranslation('chat');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{screenName}</Text>
        <Text style={styles.body}>{t('ch4.body', { screenName })}</Text>
        <SecondaryButton
          label={t('ch4.confirm', { screenName })}
          loading={loading}
          onPress={onConfirm}
        />
        <SecondaryLink label={t('ch4.cancel')} onPress={onClose} />
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
