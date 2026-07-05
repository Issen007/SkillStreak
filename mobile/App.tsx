import { useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
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

import { AppRoot } from './src/AppRoot';

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
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <StatusBar style="dark" />
      <AppRoot />
    </View>
  );
}
