import { useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts as useBaloo2Fonts,
  Baloo2_700Bold,
} from '@expo-google-fonts/baloo-2';
import {
  useFonts as useNunitoFonts,
  Nunito_400Regular,
  Nunito_700Bold,
} from '@expo-google-fonts/nunito';

import { colors } from './src/theme/colors';
import { fonts } from './src/theme/fonts';

// Keep the native splash screen up until fonts are ready, so the very first
// frame the player sees is already on-brand rather than a flash of
// unstyled text.
SplashScreen.preventAutoHideAsync();

export default function App() {
  const [baloo2Loaded] = useBaloo2Fonts({ Baloo2_700Bold });
  const [nunitoLoaded] = useNunitoFonts({ Nunito_400Regular, Nunito_700Bold });

  const fontsReady = baloo2Loaded && nunitoLoaded;

  const onLayoutRootView = useCallback(async () => {
    if (fontsReady) {
      await SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      <StatusBar style="dark" />

      <View style={styles.wordmarkBlock}>
        <Text style={styles.wordmark}>SkillStreak</Text>
        <Text style={styles.workingTitle}>arbetstitel</Text>
      </View>

      <View style={styles.confirmationCard}>
        <Text style={styles.confirmationText}>Appen är igång!</Text>
        <Text style={styles.confirmationSubtext}>
          Det här är bara en tom bekräftelseskärm som visar att
          verktygskedjan fungerar. Riktiga funktioner (streak, lagpott,
          badges) byggs i nästa fas.
        </Text>
      </View>

      <View style={styles.badge}>
        <Text style={styles.badgeText}>Fas 0.5</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 32,
  },
  wordmarkBlock: {
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: fonts.headingBold,
    fontSize: 40,
    color: colors.ink,
  },
  workingTitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    opacity: 0.6,
    marginTop: 2,
  },
  confirmationCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
    maxWidth: 320,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  confirmationText: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
  },
  confirmationSubtext: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 20,
  },
  badge: {
    backgroundColor: colors.flame,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  badgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.white,
  },
});
