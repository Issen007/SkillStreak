import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { swedishOrdinal } from '../../utils/ordinal';

interface TeamPoolCardProps {
  pointsTotal: number;
  /** Absent (rather than `0`) when this team currently has no active pot —
   * the "between seasons" case (Screen LB1). See docs/api/types.ts's note
   * on why this is optional in the client type even though a successful
   * dashboard/`me` response always includes it today. */
  rank?: number;
  teamCount?: number;
  onPress: () => void;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Screen LB1 (Fas 2.7) — rewrite of the old goal-threshold progress card.
 * Renamed "VM-Guld-tabellen" (from "Lagets VM-Guld-pott") and the percent-
 * fill bar removed entirely, not reinterpreted — there's no maximum left
 * for a bar to represent (ADR-0008 Decision 4). The whole card is now
 * tappable, opening Screen LB2's full leaderboard. Shared unchanged across
 * H1/K1 (only the numbers move), per this project's existing convention. */
export function TeamPoolCard({ pointsTotal, rank, teamCount, onPress }: TeamPoolCardProps) {
  const hasActiveSeason = rank !== undefined && teamCount !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.title}>🥇 VM-Guld-tabellen</Text>
      <Text style={styles.points}>{numberFormatter.format(pointsTotal)} poäng</Text>

      {hasActiveSeason ? (
        <Text style={styles.rankLine}>
          {swedishOrdinal(rank)} plats av {teamCount} lag
        </Text>
      ) : (
        <>
          <Text style={styles.rankLine}>Ingen aktiv säsong just nu</Text>
          <Text style={styles.sub}>Ni är med igen så fort en ny säsong startar.</Text>
        </>
      )}

      <Text style={styles.tapHint}>Se tabellen →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    gap: 4,
  },
  pressed: {
    opacity: 0.85,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  points: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
    marginTop: 2,
  },
  rankLine: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.goldText,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  tapHint: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
});
