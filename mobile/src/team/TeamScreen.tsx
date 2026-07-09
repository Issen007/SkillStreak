import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConsentChips } from './components/ConsentChips';
import { TeammateRow } from './components/TeammateRow';
import { RosterScreen } from './RosterScreen';
import { CaptainTransferScreen } from './CaptainTransferScreen';
import { TeamPoolCard } from '../home/components/TeamPoolCard';
import { LeaderboardScreen } from '../leaderboard/LeaderboardScreen';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toast } from '../components/Toast';
import { getTeamDashboard, getTeammates } from '../api/endpoints';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type { TeamDashboardResponse, TeammateEntry } from '../api/types';

interface TeamScreenProps {
  teamId: string;
  /** Needed for Screen K4's "(Du)" row — the viewer's own id isn't part of
   * the teammates response itself. */
  viewerPlayerId: string;
  /** K1's "Hantera veckans mål" shortcut switches AppShell to the "Mål"
   * tab rather than duplicating that screen here. */
  onManageGoal: () => void;
  /** Fas 2.6a — tells AppShell this device just performed a captain
   * transfer, so its next foreground check doesn't also show Screen K5's
   * (optional) "handed off" banner for a change this device already knows
   * about directly. */
  onCaptainTransferred: () => void;
}

type TeamViewState = 'summary' | 'roster' | 'captain-transfer' | 'leaderboard';

/** Screen K1 — the "Laget" tab. Every player sees the baseline aggregate
 * content (now including "Spelare i laget", Fas 2.6a); a captain
 * additionally sees a distinct card with three shortcut buttons, per
 * docs/design/phase2-flows.md Part 1 + docs/design/phase2.6-2.7-flows.md
 * Part A. Self-contained fetch on mount, same pattern as HomeScreen. */
export function TeamScreen({ teamId, viewerPlayerId, onManageGoal, onCaptainTransferred }: TeamScreenProps) {
  const [dashboard, setDashboard] = useState<TeamDashboardResponse | null>(null);
  const [teammates, setTeammates] = useState<TeammateEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<TeamViewState>('summary');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // "Fire both, render when both resolve" — one extra request, not a
  // second visible loading state, per the flow doc's Screen K1 note.
  const fetchAll = useCallback(async () => {
    try {
      const [dashboardResponse, teammatesResponse] = await Promise.all([
        getTeamDashboard(teamId),
        getTeammates(teamId),
      ]);
      setDashboard(dashboardResponse);
      setTeammates(teammatesResponse.teammates);
      setLoadError(null);
    } catch {
      setLoadError('Kunde inte hämta laget. Kolla din uppkoppling.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  if (view === 'roster') {
    return (
      <RosterScreen
        teamId={teamId}
        onBack={() => setView('summary')}
        onNotCaptain={() => {
          setView('summary');
          setToastMessage('Den här sidan är bara för lagets kapten.');
        }}
      />
    );
  }

  if (view === 'captain-transfer') {
    return (
      <CaptainTransferScreen
        teamId={teamId}
        viewerPlayerId={viewerPlayerId}
        onBack={() => setView('summary')}
        onNotCaptain={() => {
          setView('summary');
          setToastMessage('Den här sidan är bara för lagets kapten.');
        }}
        onTransferred={(newCaptainScreenName) => {
          onCaptainTransferred();
          setView('summary');
          setToastMessage(`Kaptensskapet är överlämnat till ${newCaptainScreenName}. 👑`);
          void fetchAll();
        }}
      />
    );
  }

  if (view === 'leaderboard') {
    return <LeaderboardScreen teamId={teamId} onBack={() => setView('summary')} />;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (loadError || !dashboard || !teammates) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchAll()}>
          Försök igen
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Laget 👥</Text>

        <ConsentChips
          approvedCount={dashboard.roster.approvedCount}
          pendingCount={dashboard.roster.pendingCount}
          revokedCount={dashboard.roster.revokedCount}
        />

        <Text style={styles.sectionLabel}>Spelare i laget</Text>
        <View style={styles.teammatesCard}>
          {teammates.map((teammate) => (
            <TeammateRow
              key={teammate.playerId}
              screenName={teammate.screenName}
              avatarId={teammate.avatarId}
              isCaptain={teammate.isCaptain}
            />
          ))}
        </View>

        <TeamPoolCard
          pointsTotal={dashboard.teamPool.pointsTotal}
          rank={dashboard.teamPool.rank}
          teamCount={dashboard.teamPool.teamCount}
          onPress={() => setView('leaderboard')}
        />

        {dashboard.viewerIsCaptain ? (
          <View style={styles.captainCard}>
            <Text style={styles.captainBadge}>👑 Du är kapten</Text>
            <PrimaryButton label="Se laget i detalj" onPress={() => setView('roster')} />
            <PrimaryButton label="Hantera veckans mål" onPress={onManageGoal} />
            <PrimaryButton label="Byt kapten" onPress={() => setView('captain-transfer')} />
          </View>
        ) : null}
      </ScrollView>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
    gap: 14,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 22,
    color: colors.ink,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.ink,
    marginBottom: -6,
  },
  teammatesCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 8,
  },
  captainCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  captainBadge: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.ink,
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
