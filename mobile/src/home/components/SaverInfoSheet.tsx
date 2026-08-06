import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface SaverInfoSheetProps {
  visible: boolean;
  bankedStreakSaverCount: number;
  onClose: () => void;
}

/** Recommended addition (docs/design/streak-savers-ui.md §1) — a small
 * one-tap explainer opened from `StreakCard`'s banked-saver badge, same
 * `Modal` bottom-sheet pattern as `ActivitySheet`/`EffortInfoSheet`. No
 * new fetch — `bankedStreakSaverCount` is already in scope wherever
 * `StreakCard` renders. */
export function SaverInfoSheet({ visible, bankedStreakSaverCount, onClose }: SaverInfoSheetProps) {
  const { t } = useTranslation('home');
  const hasSavers = bankedStreakSaverCount > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{t('saverInfoSheet.heading')}</Text>
        <Text style={styles.body}>
          {hasSavers
            ? t('saverInfoSheet.bodyHasSavers', { count: bankedStreakSaverCount })
            : t('saverInfoSheet.bodyNoSavers')}
        </Text>
        <PrimaryButton label={t('saverInfoSheet.close')} onPress={onClose} />
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
    lineHeight: 18,
  },
});
