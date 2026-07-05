import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OnboardingFlow } from './onboarding/OnboardingFlow';
import { AppShell } from './AppShell';
import { getSessionToken } from './api/authStorage';
import { colors } from './theme/colors';

type RootStatus = 'checking-session' | 'onboarding' | 'home';

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
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (status === 'onboarding') {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return <AppShell onSessionInvalid={handleSessionInvalid} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
