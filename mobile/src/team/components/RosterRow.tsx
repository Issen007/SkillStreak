import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';
import { formatSwedishDate } from '../../utils/formatDate';
import type { ConsentStatus } from '../../api/types';

interface RosterRowProps {
  screenName: string;
  avatarId: string;
  consentStatus: ConsentStatus;
  lastTrainedDate: string | null;
  /** ADR-0006 Decision 2 — additive on the roster response. A small crown,
   * same treatment as Screen K1's teammates list, so the captain doesn't
   * need a second screen to confirm their own status either. */
  isCaptain: boolean;
  onPress: () => void;
}

const STATUS_LABEL: Record<ConsentStatus, string> = {
  approved: 'Godkänd ✓',
  pending: 'Väntar ⏳',
  revoked: 'Pausad ⏸️',
  not_requested: 'Inte skickad än',
};

/** Screen K2's roster row — screen name, never real name, per the
 * unchanged "never real names" rule. Row tap only opens an action sheet
 * for `pending` rows (the only reachable row action once K3's reissue-code
 * action is out of scope, per this task's scope boundary) — a tap on any
 * other row is a no-op. */
export function RosterRow({
  screenName,
  avatarId,
  consentStatus,
  lastTrainedDate,
  isCaptain,
  onPress,
}: RosterRowProps) {
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === avatarId)?.emoji ?? '🙂';
  const isPending = consentStatus === 'pending';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!isPending}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && isPending && styles.pressed]}
    >
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarEmoji}>{emoji}</Text>
      </View>
      <View style={styles.textBlock}>
        <View style={styles.nameRow}>
          <Text style={styles.screenName}>{screenName}</Text>
          {isCaptain ? <Text style={styles.crown}>👑</Text> : null}
        </View>
        <Text style={styles.subLine}>
          {lastTrainedDate
            ? `Senast loggade: ${formatSwedishDate(lastTrainedDate)}`
            : 'Har inte loggat än'}
        </Text>
      </View>
      <Text style={styles.statusLabel}>{STATUS_LABEL[consentStatus]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.6,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 18,
  },
  textBlock: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  screenName: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  crown: {
    fontSize: 13,
  },
  subLine: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  statusLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'right',
  },
});
