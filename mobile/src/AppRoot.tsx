import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OnboardingFlow } from './onboarding/OnboardingFlow';
import { HomeScreen } from './home/HomeScreen';
import { getSessionToken } from './api/authStorage';
import { colors } from './theme/colors';

type RootStatus = 'checking-session' | 'onboarding' | 'home';

/** Top-level screen-state machine: not a navigation library, just "which
 * of the ~8 Phase 1 screens are we in" — appropriate for this app's size
 * per CLAUDE.md ("don't over-engineer for an app with ~8 screens").
 * Onboarding (O1-O6) and the home screen (H1/H3/H4 + H2/H5/H6) each carry
 * their own local state machine (see OnboardingFlow / HomeScreen). */
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

  return <HomeScreen onSessionInvalid={handleSessionInvalid} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
