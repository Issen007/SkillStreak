import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Trans, useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';

interface AppHeaderProps {
  screenName: string;
  avatarId: string;
  /** Fas 4.1 (docs/adr/0012-profile-page-and-contact-email-change.md) —
   * the top-right avatar circle is the profile page's entry point,
   * exactly where that roadmap item asked for a "profile icon." Optional
   * so AppHeader stays usable/testable standalone without wiring a
   * profile screen through every call site. */
  onAvatarPress?: () => void;
}

/** Home tab's top banner: wordmark + working-title note, the player's own
 * avatar (looked up from the shared `AVATAR_CATALOG` by id — the API only
 * ever sends `avatarId`, never the emoji itself), and a screen-name-only
 * greeting (never the real name, per the "screen names in any player-facing
 * UI" rule). Otherwise purely presentational — no fetch, no state. */
export function AppHeader({ screenName, avatarId, onAvatarPress }: AppHeaderProps) {
  const { t } = useTranslation('home');
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === avatarId)?.emoji ?? '🙂';

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.wordmark}>SkillStreak</Text>
        <Text style={styles.workingTitle}>{t('appHeader.workingTitle')}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('appHeader.profileAccessibilityLabel')}
        onPress={onAvatarPress}
        disabled={!onAvatarPress}
        style={({ pressed }) => [styles.avatarCircle, pressed && styles.avatarPressed]}
      >
        <Text style={styles.avatarEmoji}>{emoji}</Text>
      </Pressable>
      <Text style={styles.greeting}>
        {/* Pilot t()/Trans wiring (docs/adr/0014-multi-language-support.md
         * Decision 2's part-(a) pilot) — the `bold` tag in the `home`
         * namespace's "greeting" key maps to this Text component by name,
         * no wrapping element injected (no `parent` prop passed), so this
         * stays valid React Native output. */}
        <Trans
          i18nKey="greeting"
          ns="home"
          values={{ screenName }}
          components={{ bold: <Text style={styles.greetingName} /> }}
        />
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  wordmark: {
    fontFamily: fonts.headingBold,
    fontSize: 18,
    color: colors.ink,
  },
  workingTitle: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.textMuted,
  },
  avatarCircle: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPressed: {
    opacity: 0.7,
  },
  avatarEmoji: {
    fontSize: 18,
  },
  greeting: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  greetingName: {
    fontFamily: fonts.bodyBold,
    color: colors.ink,
  },
});
