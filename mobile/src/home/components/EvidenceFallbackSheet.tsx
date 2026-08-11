import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface EvidenceFallbackSheetProps {
  visible: boolean;
  onTryAgain: () => void;
  onLogAnyway: () => void;
  onDismiss: () => void;
}

/**
 * Shown when a video-backed session's upload did not finish.
 *
 * Before this, abandoning the upload discarded the session entirely: a
 * child trained, chose "with video", hit a flaky connection, and landed
 * back on the home screen with nothing logged and nothing said. "You
 * trained and got nothing" is precisely the message ADR-0025's floor-of-1
 * rule exists to avoid, and a dropped connection is not a child's fault.
 *
 * **This does not weaken the evidence rule.** Logging without the video
 * sends no `evidenceClipId`, so the server resolves it to `CLICK_ONLY` —
 * the client never claims a tier, it only ever supplies proof. The offer
 * is the honest lesser outcome, not a way around the requirement, and the
 * copy says so rather than hiding it: "you get fewer points, but it
 * counts".
 *
 * "Try again" is first and styled as the primary action, because keeping
 * the video is the better outcome for the child and the team — but
 * neither button is a trap, and dismissing simply leaves the session
 * unlogged as before.
 */
export function EvidenceFallbackSheet({
  visible,
  onTryAgain,
  onLogAnyway,
  onDismiss,
}: EvidenceFallbackSheetProps) {
  const { t } = useTranslation('home');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>
          {t('evidenceFallbackSheet.heading')}
        </Text>
        <Text style={styles.body}>{t('evidenceFallbackSheet.body')}</Text>

        <PrimaryButton
          label={t('evidenceFallbackSheet.tryAgain')}
          onPress={onTryAgain}
        />

        <Pressable
          accessibilityRole="button"
          onPress={onLogAnyway}
          style={styles.button}
        >
          <Text style={styles.secondaryLabel}>
            {t('evidenceFallbackSheet.logAnyway')}
          </Text>
        </Pressable>
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
    fontSize: 18,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textBody,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.textMuted,
  },
});
