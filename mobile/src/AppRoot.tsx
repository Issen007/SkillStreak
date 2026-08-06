import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { OnboardingFlow } from './onboarding/OnboardingFlow';
import { AppShell } from './AppShell';
import { getSessionToken } from './api/authStorage';
import { colors } from './theme/colors';

type RootStatus = 'checking-session' | 'onboarding' | 'home';

/** Only the hosted try-it demo (site/nginx.conf's try.* vhost) needs this —
 * a real native install isn't the "public link, no account should be
 * real" risk this guards against. Kept here rather than in site/'s own
 * static wrapper since it's the same Expo web export either way, not a
 * separate build. Shown before a language has necessarily been picked
 * (it wraps every `RootStatus`, including `checking-session`), so it uses
 * whatever `i18n.language` already resolved to (the device guess) rather
 * than depending on the player having reached Screen O0 — `common` since
 * this is app-wide chrome, not feature-scoped copy. */
function TestModeBanner() {
  const { t } = useTranslation('common');
  if (Platform.OS !== 'web') return null;
  return (
    <View style={styles.testBanner}>
      <Text style={styles.testBannerText}>{t('testModeBanner')}</Text>
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

  let body: ReactNode;
  if (status === 'checking-session') {
    body = (
      <View style={styles.centered}>
        <TestModeBanner />
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  } else if (status === 'onboarding') {
    body = (
      <View style={styles.fill}>
        <TestModeBanner />
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </View>
    );
  } else {
    body = (
      <View style={styles.fill}>
        <TestModeBanner />
        <AppShell onSessionInvalid={handleSessionInvalid} />
      </View>
    );
  }

  // Web-only: every native/mobile screen and layout in this app is
  // designed for a phone-width viewport (docs/design/style-guide.md) —
  // letting it stretch to a full, uncapped desktop browser window doesn't
  // just crop video (see ClipCard's own fix), it's the wrong frame for
  // every screen. Cap to a generous phone-plus width, centered, with the
  // brand's own `ink` fill as the surrounding backdrop rather than plain
  // white — mirrors how other mobile-first web apps (chat/social) frame
  // themselves on desktop instead of going edge-to-edge. Native is
  // completely unaffected: `Platform.OS === 'web'` gates both extra
  // styles, so this is a no-op there.
  if (Platform.OS !== 'web') {
    return body;
  }
  return (
    <View style={styles.webBackdrop}>
      <View style={styles.webColumn}>{body}</View>
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
  webBackdrop: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.ink,
  },
  webColumn: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
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
