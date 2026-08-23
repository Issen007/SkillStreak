import { useCallback, useState } from 'react';
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
import { CrashBoundary } from './src/components/CrashBoundary';
import { IntroAnimation } from './src/intro/IntroAnimation';
import { installGlobalErrorHandler } from './src/api/installGlobalErrorHandler';
// Side-effect import — runs i18next's synchronous init (src/i18n/index.ts)
// before anything below ever calls useTranslation()/t(). Must load before
// AppRoot, not lazily from within it.
import './src/i18n';

// Before anything can throw. Module scope rather than an effect inside a
// component: an error during the very first render is one this app has
// shipped before (a hooks-order crash took the Shorts tab out on every
// open, 2026-08-21), and a handler installed by an effect is not yet
// installed when that happens.
installGlobalErrorHandler();

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

  // The intro is an overlay, never a gate. AppRoot mounts and does its
  // own loading underneath it, so the animation spends time the app was
  // going to spend anyway rather than adding any of its own — a player
  // opening the app to log a session is not made to wait for it.
  const [introDone, setIntroDone] = useState(false);
  const handleIntroDone = useCallback(() => setIntroDone(true), []);

  if (!fontsReady) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      {/* Dark icons are invisible on the intro's black. */}
      <StatusBar style={introDone ? 'dark' : 'light'} />
      {/* Wraps AppRoot but NOT IntroAnimation, deliberately. The intro is
          decorative and sits above everything; if it were inside and threw,
          the fallback would render underneath it and the child would see
          the animation finish onto an error screen. Outside, a crash in the
          intro is caught by the global handler instead and costs only the
          animation. */}
      <CrashBoundary>
        <AppRoot />
      </CrashBoundary>
      {introDone ? null : <IntroAnimation onDone={handleIntroDone} />}
    </View>
  );
}
