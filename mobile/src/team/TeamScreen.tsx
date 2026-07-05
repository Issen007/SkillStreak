import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConsentChips } from './components/ConsentChips';
import { RosterScreen } from './RosterScreen';
import { TeamPoolCard } from '../home/components/TeamPoolCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toast } from '../components/Toast';
import { getTeamDashboard } from '../api/endpoints';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type { TeamDashboardResponse } from '../api/types';

interface TeamScreenProps {
  teamId: string;
  /** K1's "Hantera veckans mål" shortcut switches AppShell to the "Mål"
   * tab rather than duplicating that screen here. */
  onManageGoal: () => void;
}

type TeamViewState = 'summary' | 'roster';

/** Screen K1 — the "Laget" tab. Every player sees the baseline aggregate
 * content; a captain additionally sees a distinct card with two shortcut
 * buttons, per docs/design/phase2-flows.md Part 1. Self-contained fetch on
 * mount, same pattern as HomeScreen. */
export function TeamScreen({ teamId, onManageGoal }: TeamScreenProps) {
  const [dashboard, setDashboard] = useState<TeamDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<TeamViewState>('summary');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const response = await getTeamDashboard(teamId);
      setDashboard(response);
      setLoadError(null);
    } catch {
      setLoadError('Kunde inte hämta laget. Kolla din uppkoppling.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (loadError || !dashboard) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchDashboard()}>
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

        <TeamPoolCard
          pointsTotal={dashboard.teamPool.pointsTotal}
          goalThreshold={dashboard.teamPool.goalThreshold}
          percentComplete={dashboard.teamPool.percentComplete}
          seasonLabel={dashboard.teamPool.seasonLabel}
        />

        {dashboard.viewerIsCaptain ? (
          <View style={styles.captainCard}>
            <Text style={styles.captainBadge}>👑 Du är kapten</Text>
            <PrimaryButton label="Se laget i detalj" onPress={() => setView('roster')} />
            <PrimaryButton label="Hantera veckans mål" onPress={onManageGoal} />
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
