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
  /** The player's own parental sharing permission, or null while the status
   * request is still in flight. Anything other than `active` greys the
   * share row out — see the note on the component. */
  consent: 'none' | 'pending' | 'active' | null;
  /** Absent when the rollout has not reached this team, so no share row is
   * drawn at all — a disabled one invites a child to keep tapping
   * something nothing they can do will unlock. Missing *consent* is the
   * opposite case: there the child has something to do about it, so the
   * row stays visible and an ask row appears beside it. */
  onShare?: () => void;
  /** Absent when there is nothing useful to ask for — no rollout, consent
   * already active, or a request already pending. */
  onAskParent?: () => void;
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
 *
 * **Sharing shows its lock rather than hiding it** (project owner,
 * 2026-08-21). Until a parent has approved, the share row is greyed and
 * unpressable and an "ask your parent" row sits under it, so the state is
 * legible from the menu instead of only after a tap into the share sheet.
 * Three details are deliberate:
 *
 * - **A pending request gets a "send it again" row**, not a dead end. It
 *   first shipped with no row at all, on the reasoning that the server's
 *   cooldown would refuse a re-send anyway. That was wrong on the facts —
 *   the cooldown is 15 minutes and the cap three a day — and the day it
 *   shipped, the first consent mail went out with a broken link, leaving
 *   the only person testing it staring at "waiting for your parent" with
 *   no move. A lost mail is the ordinary case; mail-bombing is what the
 *   server's limits are for.
 * - **Unshare is never greyed.** A clip that is already public stays
 *   removable whatever the consent says; a permission that lapsed must not
 *   trap a child's own video outside the team.
 * - **The ask row opens the share sheet rather than mailing straight from
 *   here.** That sheet is where the child is told, in their own words,
 *   what a stranger would be able to see — the disclosure ADR-0030 puts
 *   in front of the decision, not after it.
 */
export function ClipActionsSheet({
  visible,
  isOwn,
  publishedPublicly,
  consent,
  onShare,
  onAskParent,
  onDelete,
  onReport,
  onClose,
}: ClipActionsSheetProps) {
  const { t } = useTranslation('clips');

  // An already-public clip is always un-shareable, consent or no consent.
  const shareEnabled = publishedPublicly || consent === 'active';
  const lockedHint =
    consent === 'pending'
      ? t('clipActions.sharePendingHint')
      : t('clipActions.shareLockedHint');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={styles.sheet}>
        {isOwn ? (
          <>
            {onShare ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !shareEnabled }}
                disabled={!shareEnabled}
                onPress={onShare}
                style={[styles.row, shareEnabled ? null : styles.rowDisabled]}
              >
                <Text
                  style={[
                    styles.rowLabel,
                    shareEnabled ? null : styles.labelDisabled,
                  ]}
                >
                  {publishedPublicly
                    ? t('clipActions.unshare')
                    : t('clipActions.share')}
                </Text>
                <Text style={styles.rowHint}>
                  {!shareEnabled
                    ? lockedHint
                    : publishedPublicly
                      ? t('clipActions.unshareHint')
                      : t('clipActions.shareHint')}
                </Text>
              </Pressable>
            ) : null}

            {!shareEnabled && onAskParent ? (
              <Pressable
                accessibilityRole="button"
                onPress={onAskParent}
                style={styles.row}
              >
                <Text style={styles.rowLabel}>
                  {consent === 'pending'
                    ? t('clipActions.askAgain')
                    : t('clipActions.askParent')}
                </Text>
                <Text style={styles.rowHint}>
                  {consent === 'pending'
                    ? t('clipActions.askAgainHint')
                    : t('clipActions.askParentHint')}
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
  // Greyed, not hidden: the row is the explanation of why sharing is not
  // available yet, so it has to stay readable while being obviously inert.
  rowDisabled: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    opacity: 0.6,
  },
  labelDisabled: {
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
