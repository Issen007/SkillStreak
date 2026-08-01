import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DangerButton } from '../../components/DangerButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ClipDeleteSheetProps {
  visible: boolean;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Screen V11 — "Ta bort det här klippet?" One confirmation step, styled
 * with `DangerButton` — this app's reserved destructive/red treatment,
 * deliberately *not* the ordinary primary/secondary styling K4's captain
 * transfer or CH4's block use, per the flow doc's judgment call 10: clip
 * deletion is genuinely, unconditionally, permanently irreversible (the
 * object is hard-deleted from storage even if the clip has open reports),
 * unlike either of those other two "are you sure" moments. */
export function ClipDeleteSheet({ visible, loading, onConfirm, onClose }: ClipDeleteSheetProps) {
  const { t } = useTranslation('clips');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{t('v11.heading')}</Text>
        <Text style={styles.body}>{t('v11.body')}</Text>
        <DangerButton label={t('v11.confirm')} loading={loading} onPress={onConfirm} />
        <SecondaryLink label={t('v11.cancel')} onPress={onClose} />
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
