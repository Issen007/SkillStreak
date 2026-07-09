import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SecondaryLink } from '../components/SecondaryLink';
import { getLeaderboard } from '../api/endpoints';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { swedishOrdinal } from '../utils/ordinal';
import type { LeaderboardEntry, LeaderboardResponse } from '../api/types';

interface LeaderboardScreenProps {
  teamId: string;
  onBack: () => void;
}

const numberFormatter = new Intl.NumberFormat('sv-SE');

/** Does the current list actually contain a tie? Drives the conditional
 * "Delad poäng ger samma placering." caption (Screen LB2) — shown only
 * when relevant, never as permanent chrome on a list with no ties. */
function hasTie(rows: LeaderboardEntry[]): boolean {
  const seenRanks = new Set<number>();
  for (const row of rows) {
    if (seenRanks.has(row.rank)) return true;
    seenRanks.add(row.rank);
  }
  return false;
}

/** Screen LB2 — the full VM-Guld-tabellen, reached by tapping the
 * rewritten `TeamPoolCard` (Screen LB1) from either Home or "Laget".
 * Self-contained fetch on mount, same pattern as every other Phase 1/2
 * screen. No further navigation once here — a check-in view, same
 * "not a flow" pattern as G1/CH1. */
export function LeaderboardScreen({ teamId, onBack }: LeaderboardScreenProps) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const response = await getLeaderboard(teamId);
      setData(response);
      setLoadError(null);
    } catch {
      setLoadError('Kunde inte hämta VM-Guld-tabellen. Kolla din uppkoppling.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  if (loadError || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchLeaderboard()}>
          Försök igen
        </Text>
      </View>
    );
  }

  const { requestingTeam, leaderboard } = data;
  const showTieCaption = hasTie(leaderboard);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.pageHeading}>VM-Guld-tabellen 🥇</Text>

      {requestingTeam === null ? (
        <View style={styles.seasonBanner}>
          <Text style={styles.seasonBannerText}>
            Ert lag har ingen aktiv säsong just nu — men kolla in de andra lagens poäng!
          </Text>
        </View>
      ) : null}

      {leaderboard.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyHeading}>Ingen tabell att visa än.</Text>
          <Text style={styles.emptySub}>Kom tillbaka när fler lag har en aktiv säsong.</Text>
        </View>
      ) : (
        <>
          {showTieCaption ? (
            <Text style={styles.tieCaption}>Delad poäng ger samma placering.</Text>
          ) : null}

          <View style={styles.list}>
            {leaderboard.map((row) => (
              <View
                key={row.teamId}
                style={[styles.row, row.isRequestingTeam && styles.rowMine]}
              >
                <Text style={styles.rank}>{swedishOrdinal(row.rank)}</Text>
                <Text style={styles.teamName} numberOfLines={1}>
                  {row.teamName}
                  {row.isRequestingTeam ? <Text style={styles.meTag}> Ditt lag</Text> : null}
                </Text>
                <Text style={styles.points}>{numberFormatter.format(row.pointsTotal)} p</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <SecondaryLink label="Tillbaka" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
    gap: 14,
  },
  pageHeading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
  },
  seasonBanner: {
    backgroundColor: colors.pendingBg,
    borderWidth: 1,
    borderColor: colors.pendingBorder,
    borderRadius: 14,
    padding: 12,
  },
  seasonBannerText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 17,
  },
  tieCaption: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowMine: {
    backgroundColor: colors.goldRowTint,
    borderColor: colors.goldRowBorder,
  },
  rank: {
    fontFamily: fonts.headingBold,
    fontSize: 15,
    color: colors.ink,
    width: 34,
  },
  teamName: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  meTag: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.goldText,
  },
  points: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.goldText,
  },
  emptyCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  emptyHeading: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
  },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
});
