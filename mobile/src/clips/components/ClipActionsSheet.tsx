import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ClipActionsSheetProps {
  visible: boolean;
  /** Your own clip, or someone else's — they get entirely different rows. */
  isOwn: boolean;
  /** Whether this clip is currently visible outside the team (ADR-0030). */
  publishedPublicly: boolean;
  /** Absent when the rollout has not reached this team, so no share row is
   * drawn at all — a disabled one invites a child to keep tapping
   * something nothing they can do will unlock. */
  onShare?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
  onClose: () => void;
}

/**
 * The menu behind a clip's ⋯ button.
 *
 * **Replaces a tap-to-reveal that nobody could find.** The actions used
 * to appear as inline text links after tapping the caption area — an
 * undiscoverable gesture with no affordance, reported by the project
 * owner on 2026-08-21 as "very difficult to hit". For a nine-year-old, a
 * control that only exists after a gesture nothing hints at effectively
 * does not exist.
 *
 * **Delete keeps its distance.** It sits below a divider and is the only
 * row in the error colour, because it is the one action here that cannot
 * be undone — sharing and un-sharing are both reversible in a tap. Two
 * children reaching for "share" and hitting "delete" is the failure this
 * layout is arranged to prevent.
 */
export function ClipActionsSheet({
  visible,
  isOwn,
  publishedPublicly,
  onShare,
  onDelete,
  onReport,
  onClose,
}: ClipActionsSheetProps) {
  const { t } = useTranslation('clips');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={styles.sheet}>
        {isOwn ? (
          <>
            {onShare ? (
              <Pressable
                accessibilityRole="button"
                onPress={onShare}
                style={styles.row}
              >
                <Text style={styles.rowLabel}>
                  {publishedPublicly
                    ? t('clipActions.unshare')
                    : t('clipActions.share')}
                </Text>
                <Text style={styles.rowHint}>
                  {publishedPublicly
                    ? t('clipActions.unshareHint')
                    : t('clipActions.shareHint')}
                </Text>
              </Pressable>
            ) : null}

            {onDelete ? (
              <>
                <View style={styles.divider} />
                <Pressable
                  accessibilityRole="button"
                  onPress={onDelete}
                  style={styles.row}
                >
                  <Text style={[styles.rowLabel, styles.destructive]}>
                    {t('clipActions.delete')}
                  </Text>
                  <Text style={styles.rowHint}>{t('clipActions.deleteHint')}</Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : onReport ? (
          <Pressable accessibilityRole="button" onPress={onReport} style={styles.row}>
            <Text style={styles.rowLabel}>{t('clipActions.report')}</Text>
            <Text style={styles.rowHint}>{t('clipActions.reportHint')}</Text>
          </Pressable>
        ) : null}

        <SecondaryLink label={t('clipActions.cancel')} onPress={onClose} />
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
    paddingBottom: 28,
    gap: 8,
  },
  row: {
    // 60pt of height before the text even wraps. These are the rows a
    // child taps while holding a phone one-handed, and the old affordance
    // was 15px of text.
    minHeight: 60,
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 2,
  },
  rowLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
  },
  rowHint: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  destructive: {
    color: colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
});
