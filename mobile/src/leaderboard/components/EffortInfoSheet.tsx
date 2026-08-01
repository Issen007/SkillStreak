import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import i18n from '../../i18n';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { LeaderboardResponse } from '../../api/types';

interface EffortInfoSheetProps {
  visible: boolean;
  /** Own team's unbucketed effort numbers — `null` when the requesting
   * team currently has 0 eligible players (same case that hides the
   * "Mest poäng"-tab nudge line and the effort tab's own-team row). This
   * is the one place `adjustedScore` is ever shown, and it deliberately
   * uses the requester's own exact `eligiblePlayerCount`, never the
   * bucketed `eligiblePlayerCountRange` other teams' rows get. */
  requestingTeamEffort: LeaderboardResponse['requestingTeamEffort'];
  onClose: () => void;
}

function oneDecimalFormatter() {
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Screen LB3 — "Så räknar vi ut Bästa laginsats" info sheet, reached from
 * the "Bästa laginsats" tab's "ⓘ Så räknar vi ut det" link. Same bottom-
 * sheet visual pattern as `CaptainTransferConfirmSheet`/
 * `ReminderActionSheet`, but — unlike CH0 — not gated by a one-time local
 * flag: this is reference material a player might reopen any time
 * curiosity strikes, so it stays reachable forever (docs/design/
 * phase2.6-2.7-flows.md's Addendum). */
export function EffortInfoSheet({ visible, requestingTeamEffort, onClose }: EffortInfoSheetProps) {
  const { t } = useTranslation('home');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>{t('leaderboard.infoSheet.heading')}</Text>
        <Text style={styles.body}>{t('leaderboard.infoSheet.body1')}</Text>
        <Text style={styles.body}>{t('leaderboard.infoSheet.body2')}</Text>

        {requestingTeamEffort !== null ? (
          <Text style={styles.ownTeamLine}>
            {t('leaderboard.infoSheet.ownTeamLine', {
              pointsPerPlayer: oneDecimalFormatter().format(requestingTeamEffort.pointsPerPlayer),
              playerCount: requestingTeamEffort.eligiblePlayerCount,
              adjustedScore: oneDecimalFormatter().format(requestingTeamEffort.adjustedScore),
            })}
          </Text>
        ) : null}

        <PrimaryButton label={t('leaderboard.infoSheet.gotIt')} onPress={onClose} />
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
  ownTeamLine: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.goldText,
    backgroundColor: colors.goldRowTint,
    borderWidth: 1,
    borderColor: colors.goldRowBorder,
    borderRadius: 14,
    padding: 10,
    lineHeight: 17,
  },
});
