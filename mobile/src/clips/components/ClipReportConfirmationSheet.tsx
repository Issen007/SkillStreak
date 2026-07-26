import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ClipReportReason } from '../../api/types';

interface ClipReportConfirmationSheetProps {
  visible: boolean;
  reason: ClipReportReason;
  reportedScreenName: string;
  onBlock: () => void;
  onDone: () => void;
}

/** Screen V10 — "Tack för att du sa till." Carries more weight than chat's
 * CH3 equivalent, precisely because the underlying behavior is different
 * (ADR-0010 Decision 4): this report just did something concrete and
 * immediate, so the copy says so plainly — while still holding the same
 * honest limit CH3's copy already had to hold (a hide is not a promise of
 * a fast human review). The block follow-up only fires for the two reasons
 * where "stop showing me this person's stuff" is the obviously relevant
 * next step, mirroring CH3's exact reasoning for its own two categories. */
export function ClipReportConfirmationSheet({
  visible,
  reason,
  reportedScreenName,
  onBlock,
  onDone,
}: ClipReportConfirmationSheetProps) {
  const [followUpDismissed, setFollowUpDismissed] = useState(false);
  const showBlockFollowUp =
    !followUpDismissed && (reason === 'appears_without_consent' || reason === 'bullying');

  useEffect(() => {
    if (visible) setFollowUpDismissed(false);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDone}>
      <Pressable style={styles.backdrop} onPress={onDone} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Tack för att du sa till.</Text>
        <Text style={styles.body}>
          Videon är nu dold för hela laget, inklusive dig själv. Ingen får veta att det var du
          som rapporterade.
        </Text>
        <Text style={styles.bodySecondary}>
          En vuxen får reda på det här, men vi kan inte lova exakt när videon granskas igen.
        </Text>

        {showBlockFollowUp ? (
          <>
            <Text style={styles.followUp}>
              Vill du också slippa se fler Shorts och meddelanden från den personen?
            </Text>
            <SecondaryButton label={`Blockera ${reportedScreenName}`} onPress={onBlock} />
            <SecondaryLink label="Nej tack" onPress={() => setFollowUpDismissed(true)} />
          </>
        ) : null}

        <PrimaryButton label="Klar" onPress={onDone} />
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
    fontSize: 17,
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
  bodySecondary: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  followUp: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
    textAlign: 'center',
    marginTop: 4,
  },
});
