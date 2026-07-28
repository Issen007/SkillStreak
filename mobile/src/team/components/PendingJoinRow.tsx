import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';

interface PendingJoinRowProps {
  screenName: string;
  avatarId: string;
  approving: boolean;
  rejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
}

/** Fas 4 — one row in Laget's "Väntar på godkännande" section
 * (docs/adr/0009-self-service-team-creation.md's 2026-07-27 addendum).
 * Reuses TeammateRow's avatar-circle treatment but adds the two decision
 * buttons that row never needs. */
export function PendingJoinRow({
  screenName,
  avatarId,
  approving,
  rejecting,
  onApprove,
  onReject,
}: PendingJoinRowProps) {
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === avatarId)?.emoji ?? '🙂';
  const busy = approving || rejecting;

  return (
    <View style={styles.row}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarEmoji}>{emoji}</Text>
      </View>
      <Text style={styles.name}>{screenName}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onReject}
        disabled={busy}
        style={({ pressed }) => [
          styles.actionButton,
          styles.rejectButton,
          (pressed || busy) && styles.actionPressed,
        ]}
      >
        <Text style={styles.rejectText}>{rejecting ? '…' : 'Neka'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onApprove}
        disabled={busy}
        style={({ pressed }) => [
          styles.actionButton,
          styles.approveButton,
          (pressed || busy) && styles.actionPressed,
        ]}
      >
        <Text style={styles.approveText}>{approving ? '…' : 'Godkänn'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  actionButton: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  approveButton: {
    backgroundColor: colors.flame,
    borderColor: colors.flame,
  },
  rejectButton: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  actionPressed: {
    opacity: 0.6,
  },
  approveText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.white,
  },
  rejectText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.textMuted,
  },
});
