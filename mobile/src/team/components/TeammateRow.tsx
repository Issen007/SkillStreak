import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';

interface TeammateRowProps {
  screenName: string;
  avatarId: string;
  isCaptain: boolean;
  /** K1's baseline list is never tappable, for anyone (docs/design/
   * phase2.6-2.7-flows.md's judgment call 2) — omit `onPress` there. K4's
   * transfer-target list passes it for every row except the viewer's own
   * (which passes `isSelf` instead, see below). */
  onPress?: () => void;
  /** K4 only — shows a "(Du)" label instead of a tap target for the
   * viewer's own row, per the flow doc: visible for completeness without
   * inviting a confusing self-transfer attempt. */
  isSelf?: boolean;
}

/** Reuses the avatar-circle treatment from `RosterRow`, not `RosterRow`
 * itself — this list has no consent chip, no "last trained" line, and
 * (outside K4) no tap action, since none of that data exists on the
 * teammates response. Shared between Screen K1's baseline "Spelare i
 * laget" section and Screen K4's transfer-target list. */
export function TeammateRow({ screenName, avatarId, isCaptain, onPress, isSelf = false }: TeammateRowProps) {
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === avatarId)?.emoji ?? '🙂';
  const tappable = !isSelf && onPress !== undefined;

  const content = (
    <>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarEmoji}>{emoji}</Text>
      </View>
      <Text style={styles.name}>{screenName}</Text>
      {isSelf ? <Text style={styles.selfTag}>(Du)</Text> : null}
      {isCaptain ? <Text style={styles.crown}>👑</Text> : null}
    </>
  );

  if (tappable) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 16,
  },
  name: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  selfTag: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  crown: {
    fontSize: 15,
  },
});
