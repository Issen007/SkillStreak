import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import i18n from '../../i18n';
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
  /** ADR-0016 addendum (2026-07-31) — the small "🌟 {ordinal} bäst i
   * laginsats" teaser line. Rendered only when present and non-null: it's
   * `undefined`/`null` between seasons (no active pot at all, same case as
   * `rank`/`teamCount`) and also `null` specifically when this team has 0
   * eligible players even during an active season — both cases are
   * graceful omissions, not errors, per Screen LB1's spec. */
  effortRank?: number | null;
  onPress: () => void;
}

function numberFormatter() {
  return new Intl.NumberFormat(i18n.language);
}

/** Screen LB1 (Fas 2.7) — rewrite of the old goal-threshold progress card.
 * Renamed "VM-Guld-tabellen" (from "Lagets VM-Guld-pott") and the percent-
 * fill bar removed entirely, not reinterpreted — there's no maximum left
 * for a bar to represent (ADR-0008 Decision 4). The whole card is now
 * tappable, opening Screen LB2's full leaderboard. Shared unchanged across
 * H1/K1 (only the numbers move), per this project's existing convention. */
export function TeamPoolCard({
  pointsTotal,
  rank,
  teamCount,
  effortRank,
  onPress,
}: TeamPoolCardProps) {
  const { t } = useTranslation('home');
  const hasActiveSeason = rank !== undefined && teamCount !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.title}>{t('teamPoolCard.title')}</Text>
      <Text style={styles.points}>
        {t('teamPoolCard.points', { points: numberFormatter().format(pointsTotal) })}
      </Text>

      {hasActiveSeason ? (
        <Text style={styles.rankLine}>
          {t('teamPoolCard.rankLine', { rank: swedishOrdinal(rank), teamCount })}
        </Text>
      ) : (
        <>
          <Text style={styles.rankLine}>{t('teamPoolCard.noActiveSeason')}</Text>
          <Text style={styles.sub}>{t('teamPoolCard.noActiveSeasonSub')}</Text>
        </>
      )}

      {effortRank != null ? (
        <Text style={styles.effortLine}>
          {t('teamPoolCard.effortLine', { effortRank: swedishOrdinal(effortRank) })}
        </Text>
      ) : null}

      <Text style={styles.tapHint}>{t('teamPoolCard.tapHint')}</Text>
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
  // ADR-0016 addendum (2026-07-31) — deliberately smaller than `rankLine`
  // and visually secondary, per Screen LB1's "one small emoji-prefixed
  // line, not competing with the big points figure" spec.
  effortLine: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.goldText,
  },
  tapHint: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
});
