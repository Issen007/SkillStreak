import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O2ConfirmTeamProps {
  teamName: string;
  onConfirm: () => void;
  onReject: () => void;
}

export function O2ConfirmTeam({ teamName, onConfirm, onReject }: O2ConfirmTeamProps) {
  return (
    <ScreenContainer>
      <View style={styles.spacerTop} />
      <Text style={styles.icon}>🏒</Text>
      <Text style={styles.heading}>Ansluter du till {teamName}?</Text>
      <Text style={styles.sub}>Stämmer det, så kör vi!</Text>

      <View style={styles.spacer} />

      <PrimaryButton label="Ja, det är mitt lag!" onPress={onConfirm} />
      <SecondaryLink label="Nej, testa en annan kod" onPress={onReject} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 24 },
  spacer: { flex: 1, minHeight: 24 },
  icon: {
    fontSize: 40,
    textAlign: 'center',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
