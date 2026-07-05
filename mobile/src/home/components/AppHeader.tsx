import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';

interface AppHeaderProps {
  screenName: string;
  avatarId: string;
}

/** Home tab's top banner: wordmark + working-title note, the player's own
 * avatar (looked up from the shared `AVATAR_CATALOG` by id — the API only
 * ever sends `avatarId`, never the emoji itself), and a screen-name-only
 * greeting (never the real name, per the "screen names in any player-facing
 * UI" rule). Purely presentational — no fetch, no state. */
export function AppHeader({ screenName, avatarId }: AppHeaderProps) {
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === avatarId)?.emoji ?? '🙂';

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.wordmark}>SkillStreak</Text>
        <Text style={styles.workingTitle}>arbetstitel</Text>
      </View>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarEmoji}>{emoji}</Text>
      </View>
      <Text style={styles.greeting}>
        Hej, <Text style={styles.greetingName}>{screenName}</Text>!
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
