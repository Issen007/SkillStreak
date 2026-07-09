import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ChatReportReason } from '../../api/types';

interface ReportConfirmationSheetProps {
  visible: boolean;
  reason: ChatReportReason;
  reportedScreenName: string;
  onBlock: () => void;
  onDone: () => void;
}

/** Screen CH3 — the report confirmation. Per ADR-0007 Decision 3's
 * explicit, unclosed gap: reassures without promising anything this app
 * cannot guarantee — deliberately no claim about review time, "we'll look
 * at it right away," or that the message will be removed. */
export function ReportConfirmationSheet({
  visible,
  reason,
  reportedScreenName,
  onBlock,
  onDone,
}: ReportConfirmationSheetProps) {
  const [followUpDismissed, setFollowUpDismissed] = useState(false);
  const showBlockFollowUp =
    !followUpDismissed && (reason === 'bullying' || reason === 'inappropriate_language');

  // Reset the "Nej tack" dismissal each time a *new* report confirmation is
  // shown (this sheet instance is reused across separate report events).
  useEffect(() => {
    if (visible) setFollowUpDismissed(false);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDone}>
      <Pressable style={styles.backdrop} onPress={onDone} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Tack för att du sa till.</Text>
        <Text style={styles.body}>
          Vi har tagit emot din rapport. Du behöver inte göra något mer – och ingen får veta att
          det var du som rapporterade.
        </Text>

        {showBlockFollowUp ? (
          <>
            <Text style={styles.followUp}>
              Vill du också slippa se fler meddelanden från den personen?
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
  followUp: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
    textAlign: 'center',
    marginTop: 4,
  },
});
