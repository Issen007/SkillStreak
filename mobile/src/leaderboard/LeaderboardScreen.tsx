import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SecondaryLink } from '../components/SecondaryLink';
import { EffortInfoSheet } from './components/EffortInfoSheet';
import { getLeaderboard } from '../api/endpoints';
import i18n from '../i18n';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { swedishOrdinal } from '../utils/ordinal';
import type { EffortLeaderboardEntry, LeaderboardEntry, LeaderboardResponse } from '../api/types';

interface LeaderboardScreenProps {
  teamId: string;
  onBack: () => void;
}

type LeaderboardTab = 'points' | 'effort';

function numberFormatter() {
  return new Intl.NumberFormat(i18n.language);
}
function oneDecimalFormatter() {
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Does the current list actually contain a tie? Drives the conditional
 * "Delad poäng ger samma placering." caption (Screen LB2) — shown only
 * when relevant, never as permanent chrome on a list with no ties.
 * Generic over any ranked row so it's reused verbatim (not reimplemented)
 * for both the raw `leaderboard` and the ADR-0016 `effortLeaderboard`. */
function hasTie(rows: { rank: number }[]): boolean {
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
 * screen. No further navigation once here (aside from the ADR-0016
 * addendum's LB3 info sheet) — a check-in view, same "not a flow" pattern
 * as G1/CH1. */
export function LeaderboardScreen({ teamId, onBack }: LeaderboardScreenProps) {
  const { t } = useTranslation('home');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // ADR-0016 addendum (2026-07-31) — tab switch is instant/client-side
  // only, both rankings already arrived in the one fetch above, so this is
  // plain local state, never re-triggers `fetchLeaderboard`.
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('points');
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const response = await getLeaderboard(teamId);
      setData(response);
      setLoadError(null);
    } catch {
      setLoadError(t('leaderboard.loadError'));
    } finally {
      setLoading(false);
    }
  }, [teamId, t]);

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
        <Text style={styles.errorText}>{loadError ?? t('leaderboard.genericError')}</Text>
        <Text style={styles.retryText} onPress={() => void fetchLeaderboard()}>
          {t('leaderboard.retry')}
        </Text>
      </View>
    );
  }

  const { requestingTeam, leaderboard, requestingTeamEffort, effortLeaderboard } = data;

  // "Mest poäng" tab's optional discovery nudge (cuttable per the design
  // doc — kept here since it's a one-line comparison, not meaningful
  // added complexity): only when the effort rank is a genuine improvement
  // over the raw rank, for a team that has both.
  const showEffortNudge =
    requestingTeam !== null &&
    requestingTeamEffort !== null &&
    requestingTeamEffort.rank < requestingTeam.rank;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.pageHeading}>{t('leaderboard.pageHeading')}</Text>

      <View style={styles.tabRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'points' }}
          onPress={() => setActiveTab('points')}
          style={[styles.tabSegment, activeTab === 'points' && styles.tabSegmentActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'points' && styles.tabLabelActive]}>
            {t('leaderboard.tabPoints')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'effort' }}
          onPress={() => setActiveTab('effort')}
          style={[styles.tabSegment, activeTab === 'effort' && styles.tabSegmentActive]}
        >
          <Text style={[styles.tabLabel, activeTab === 'effort' && styles.tabLabelActive]}>
            {t('leaderboard.tabEffort')}
          </Text>
        </Pressable>
      </View>

      {activeTab === 'points' ? (
        <>
          {showEffortNudge ? (
            <Text style={styles.nudgeLine} onPress={() => setActiveTab('effort')}>
              {t('leaderboard.effortNudge')}
            </Text>
          ) : null}

          {requestingTeam === null ? (
            <View style={styles.seasonBanner}>
              <Text style={styles.seasonBannerText}>{t('leaderboard.noActiveSeasonBanner')}</Text>
            </View>
          ) : null}

          {leaderboard.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyHeading}>{t('leaderboard.emptyPointsHeading')}</Text>
              <Text style={styles.emptySub}>{t('leaderboard.emptyPointsSub')}</Text>
            </View>
          ) : (
            <PointsList leaderboard={leaderboard} />
          )}
        </>
      ) : (
        <EffortTab
          requestingTeamEffort={requestingTeamEffort}
          effortLeaderboard={effortLeaderboard}
          onOpenInfoSheet={() => setInfoSheetOpen(true)}
        />
      )}

      <SecondaryLink label={t('leaderboard.back')} onPress={onBack} />

      <EffortInfoSheet
        visible={infoSheetOpen}
        requestingTeamEffort={requestingTeamEffort}
        onClose={() => setInfoSheetOpen(false)}
      />
    </ScrollView>
  );
}

/** "Mest poäng" tab's list — unchanged, byte-for-byte, from before the
 * ADR-0016 addendum, just pulled out into its own function so the tab
 * switch above stays readable. */
function PointsList({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  const { t } = useTranslation('home');
  const showTieCaption = hasTie(leaderboard);

  return (
    <>
      {showTieCaption ? <Text style={styles.tieCaption}>{t('leaderboard.tieCaption')}</Text> : null}

      <View style={styles.list}>
        {leaderboard.map((row) => (
          <View key={row.teamId} style={[styles.row, row.isRequestingTeam && styles.rowMine]}>
            <Text style={styles.rank}>{swedishOrdinal(row.rank)}</Text>
            <Text style={styles.teamName} numberOfLines={1}>
              {row.teamName}
              {row.isRequestingTeam ? (
                <Text style={styles.meTag}> {t('leaderboard.meTag')}</Text>
              ) : null}
            </Text>
            <Text style={styles.points}>
              {numberFormatter().format(row.pointsTotal)} {t('leaderboard.pointsSuffix')}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

interface EffortTabProps {
  requestingTeamEffort: LeaderboardResponse['requestingTeamEffort'];
  effortLeaderboard: EffortLeaderboardEntry[];
  onOpenInfoSheet: () => void;
}

/** "Bästa laginsats" tab (ADR-0016 addendum, 2026-07-31, Screen LB2). */
function EffortTab({ requestingTeamEffort, effortLeaderboard, onOpenInfoSheet }: EffortTabProps) {
  const { t } = useTranslation('home');
  const showTieCaption = hasTie(effortLeaderboard);

  return (
    <>
      <Text style={styles.effortCaption}>{t('leaderboard.effortCaption')}</Text>
      <Text style={styles.infoLink} onPress={onOpenInfoSheet}>
        {t('leaderboard.infoLink')}
      </Text>

      {requestingTeamEffort === null ? (
        <View style={styles.seasonBanner}>
          <Text style={styles.seasonBannerText}>{t('leaderboard.noEffortBanner')}</Text>
        </View>
      ) : null}

      {effortLeaderboard.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyHeading}>{t('leaderboard.emptyEffortHeading')}</Text>
          <Text style={styles.emptySub}>{t('leaderboard.emptyEffortSub')}</Text>
        </View>
      ) : (
        <>
          {showTieCaption ? (
            <Text style={styles.tieCaption}>{t('leaderboard.tieCaption')}</Text>
          ) : null}

          <View style={styles.list}>
            {effortLeaderboard.map((row) => (
              <View key={row.teamId} style={[styles.row, row.isRequestingTeam && styles.rowMine]}>
                <Text style={styles.rank}>
                  {row.rank === 1 ? '🏆 ' : ''}
                  {swedishOrdinal(row.rank)}
                </Text>
                <Text style={styles.teamName} numberOfLines={1}>
                  {row.teamName}
                  <Text style={styles.playerCountTag}>
                    {' '}
                    · {row.eligiblePlayerCountRange} {t('leaderboard.playerCountSuffix')}
                  </Text>
                  {row.isRequestingTeam ? (
                    <Text style={styles.meTag}> {t('leaderboard.meTag')}</Text>
                  ) : null}
                </Text>
                <Text style={styles.points}>
                  {oneDecimalFormatter().format(row.pointsPerPlayer)}{' '}
                  {t('leaderboard.pointsPerPlayerSuffix')}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </>
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
  tabRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tabSegment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tabSegmentActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  tabLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
  },
  tabLabelActive: {
    color: colors.ink,
  },
  nudgeLine: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.goldText,
    textAlign: 'center',
  },
  effortCaption: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textBody,
    textAlign: 'center',
  },
  infoLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    textDecorationLine: 'underline',
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
    width: 50,
  },
  teamName: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  playerCountTag: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
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
