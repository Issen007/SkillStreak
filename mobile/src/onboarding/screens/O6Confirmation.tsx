import { StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../../components/ScreenContainer';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface O6ConfirmationProps {
  screenName: string;
  onDone: () => void;
}

export function O6Confirmation({ screenName, onDone }: O6ConfirmationProps) {
  return (
    <ScreenContainer>
      <View style={styles.spacerTop} />
      <Text style={styles.icon}>✅👋</Text>
      <Text style={styles.heading}>Klart, {screenName}!</Text>
      <Text style={styles.body}>
        Vi har skickat en fråga till en förälder eller vårdnadshavare. Så
        fort de säger ja kan du börja logga träningar och tjäna poäng till
        laget.
      </Text>

      <View style={styles.spacer} />

      <PrimaryButton label="Nu kör vi" onPress={onDone} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  spacerTop: { height: 32 },
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
  body: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 21,
  },
});
