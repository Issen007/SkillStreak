import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { Avatar } from '../../components/Avatar';

interface ErasureSuccessorRowProps {
  screenName: string;
  avatarId: string;
  selected: boolean;
  onPress: () => void;
}

/** Screen E3's row — a single-select "who becomes captain" row, distinct
 * from `team/components/TeammateRow` (used by K1/K4) because this list
 * needs a persisted selected/highlighted state until "Klar" is tapped
 * (K4's rows aren't selectable — a tap there opens an immediate confirm
 * sheet instead), matching the mockup's `.teammate-row.selected`/
 * `.radio.on` treatment. */
export function ErasureSuccessorRow({ screenName, avatarId, selected, onPress }: ErasureSuccessorRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
    >
      <View style={styles.avatarCircle}>
        <Avatar avatarId={avatarId} size={20} />
      </View>
      <Text style={styles.name}>{screenName}</Text>
      <View style={[styles.radio, selected && styles.radioOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  rowSelected: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  pressed: {
    opacity: 0.7,
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
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  radioOn: {
    borderColor: colors.flame,
    backgroundColor: colors.flame,
  },
});
