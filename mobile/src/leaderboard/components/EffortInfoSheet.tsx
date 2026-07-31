import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
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

const oneDecimalFormatter = new Intl.NumberFormat('sv-SE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Screen LB3 — "Så räknar vi ut Bästa laginsats" info sheet, reached from
 * the "Bästa laginsats" tab's "ⓘ Så räknar vi ut det" link. Same bottom-
 * sheet visual pattern as `CaptainTransferConfirmSheet`/
 * `ReminderActionSheet`, but — unlike CH0 — not gated by a one-time local
 * flag: this is reference material a player might reopen any time
 * curiosity strikes, so it stays reachable forever (docs/design/
 * phase2.6-2.7-flows.md's Addendum). */
export function EffortInfoSheet({ visible, requestingTeamEffort, onClose }: EffortInfoSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Så räknar vi ut Bästa laginsats</Text>
        <Text style={styles.body}>
          Vi jämför hur många poäng varje lag får per spelare — inte bara lagets totalsumma. Så
          kan även ett litet lag vinna genom att alla kämpar på.
        </Text>
        <Text style={styles.body}>
          Om ett lag är litet räknar vi lite försiktigt, så att några enstaka riktigt bra dagar
          inte råkar ge förstaplatsen av en slump. Ju fler spelare ett lag har, desto mer litar vi
          på deras eget snitt.
        </Text>

        {requestingTeamEffort !== null ? (
          <Text style={styles.ownTeamLine}>
            Ditt lag: {oneDecimalFormatter.format(requestingTeamEffort.pointsPerPlayer)} p/spelare
            med {requestingTeamEffort.eligiblePlayerCount} spelare →{' '}
            {oneDecimalFormatter.format(requestingTeamEffort.adjustedScore)} p när vi räknar
            rättvist.
          </Text>
        ) : null}

        <PrimaryButton label="Okej, jag fattar!" onPress={onClose} />
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
