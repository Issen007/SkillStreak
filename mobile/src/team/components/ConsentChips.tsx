import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ConsentChipsProps {
  approvedCount: number;
  pendingCount: number;
  revokedCount: number;
}

/** Screen K1's baseline aggregate chips — counts only, never names, per
 * the flow doc ("this is deliberately the *most* team-management detail a
 * non-captain ever sees, and it's non-identifying"). A chip is omitted
 * entirely when its count is 0. */
export function ConsentChips({ approvedCount, pendingCount, revokedCount }: ConsentChipsProps) {
  return (
    <View style={styles.row}>
      {approvedCount > 0 ? (
        <View style={[styles.chip, styles.approved]}>
          <Text style={styles.chipText}>{approvedCount} godkända ✓</Text>
        </View>
      ) : null}
      {pendingCount > 0 ? (
        <View style={[styles.chip, styles.pending]}>
          <Text style={styles.chipText}>{pendingCount} väntar ⏳</Text>
        </View>
      ) : null}
      {revokedCount > 0 ? (
        <View style={[styles.chip, styles.revoked]}>
          <Text style={styles.chipText}>{revokedCount} pausade ⏸️</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  approved: {
    backgroundColor: '#EAF6EE',
    borderColor: colors.success,
  },
  pending: {
    backgroundColor: colors.pendingBg,
    borderColor: colors.pendingBorder,
  },
  revoked: {
    backgroundColor: colors.pausedBg,
    borderColor: colors.pausedBorder,
  },
  chipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.ink,
  },
});
