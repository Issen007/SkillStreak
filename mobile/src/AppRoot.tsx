import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { OnboardingFlow } from './onboarding/OnboardingFlow';
import { AppShell } from './AppShell';
import { getSessionToken } from './api/authStorage';
import { colors } from './theme/colors';

type RootStatus = 'checking-session' | 'onboarding' | 'home';

/** Only the hosted try-it demo (site/nginx.conf's try.* vhost) needs this —
 * a real native install isn't the "public link, no account should be
 * real" risk this guards against. Kept here rather than in site/'s own
 * static wrapper since it's the same Expo web export either way, not a
 * separate build. */
function TestModeBanner() {
  if (Platform.OS !== 'web') return null;
  return (
    <View style={styles.testBanner}>
      <Text style={styles.testBannerText}>
        🧪 Det här är bara ett TEST — skapa inte ett riktigt konto med
        riktiga uppgifter.
      </Text>
    </View>
  );
}

/** Top-level screen-state machine: not a navigation library, just "are we
 * onboarding or in the app" — appropriate for this app's size per
 * CLAUDE.md. Onboarding (O1-O6) carries its own local state machine (see
 * OnboardingFlow); once inside the app, `AppShell` owns the Phase 2 tab
 * bar (Hem/Mål/Laget), each tab in turn owning its own screen(s). */
export function AppRoot() {
  const [status, setStatus] = useState<RootStatus>('checking-session');

  useEffect(() => {
    void (async () => {
      try {
        const token = await getSessionToken();
        setStatus(token ? 'home' : 'onboarding');
      } catch {
        // SecureStore read failed (e.g. iOS Keychain-before-first-unlock,
        // Android Keystore corruption) — treat exactly like "no token":
        // starting onboarding again is an acceptable, simple recovery, and
        // beats leaving the kid stuck on the spinner forever.
        setStatus('onboarding');
      }
    })();
  }, []);

  const handleOnboardingComplete = useCallback(() => setStatus('home'), []);
  const handleSessionInvalid = useCallback(() => setStatus('onboarding'), []);

  if (status === 'checking-session') {
    return (
      <View style={styles.centered}>
        <TestModeBanner />
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (status === 'onboarding') {
    return (
      <View style={styles.fill}>
        <TestModeBanner />
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <TestModeBanner />
      <AppShell onSessionInvalid={handleSessionInvalid} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBanner: {
    backgroundColor: '#FFB800',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  testBannerText: {
    color: '#1B1B3A',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
