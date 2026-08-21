import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { PublicSharingStatus } from '../../api/types';

interface ClipShareSheetProps {
  visible: boolean;
  loading: boolean;
  /** Null while the status request is still in flight. */
  status: PublicSharingStatus | null;
  /** Whether *this* clip is currently public. */
  isShared: boolean;
  error: string | null;
  onAskParent: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onClose: () => void;
}

/**
 * ADR-0030 — the child's end of sharing a clip outside the team.
 *
 * Four states, and which one shows is driven entirely by the server's
 * answer rather than by anything the app decides: no consent yet, waiting
 * on the parent, allowed but this clip is private, and this clip is
 * public. The app never combines "allow-listed" and "consented" itself —
 * `canShare` arrives already resolved, so the rule cannot drift between
 * the two codebases.
 *
 * **The copy names what a stranger can see, on the screen where the child
 * decides.** A child of 9–13 cannot consent to an abstraction, and burying
 * it in a privacy policy they will not read would make the tap
 * meaningless. Screen name and avatar, never real name, team or place —
 * the same three exclusions the parent's approval page promises, worded
 * for the person actually pressing the button.
 */
export function ClipShareSheet({
  visible,
  loading,
  status,
  isShared,
  error,
  onAskParent,
  onPublish,
  onUnpublish,
  onClose,
}: ClipShareSheetProps) {
  const { t } = useTranslation('clips');

  const body = () => {
    if (isShared) {
      return {
        heading: t('clipShareSheet.headingShared'),
        text: t('clipShareSheet.bodyShared'),
        action: t('clipShareSheet.unpublish'),
        onPress: onUnpublish,
      };
    }
    if (status?.consent === 'active') {
      return {
        heading: t('clipShareSheet.headingOn'),
        text: t('clipShareSheet.bodyOn'),
        action: t('clipShareSheet.publish'),
        onPress: onPublish,
      };
    }
    if (status?.consent === 'pending') {
      // This used to offer no action at all, reasoning that a re-send
      // would invite a child to mail-bomb their parent and that the
      // server's cooldown would refuse anyway. The second half was simply
      // wrong: the cooldown is 15 minutes and the cap is three a day, so
      // asking again is both allowed and, on 2026-08-21, the only way out
      // of a real trap — the first consent mail went out with a broken
      // link, and "wait for your parent" is a dead end when the mail they
      // were sent cannot be acted on.
      //
      // A lost or unopened mail is the ordinary case this serves. The
      // mail-bomb worry is real and is what the server's limits are for;
      // it is not a reason to leave a child with no move.
      return {
        heading: t('clipShareSheet.headingPending'),
        text: t('clipShareSheet.bodyPending'),
        action: t('clipShareSheet.askAgain'),
        onPress: onAskParent,
      };
    }
    return {
      heading: t('clipShareSheet.headingOff'),
      text: t('clipShareSheet.bodyNone'),
      action: t('clipShareSheet.ask'),
      onPress: onAskParent,
    };
  };

  const { heading, text, action, onPress } = body();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.body}>{text}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {action && onPress ? (
          <PrimaryButton label={action} loading={loading} onPress={onPress} />
        ) : null}
        <SecondaryLink label={t('clipShareSheet.close')} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(27,27,58,0.35)' },
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
    fontSize: 14,
    lineHeight: 20,
    color: colors.textBody,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
});
