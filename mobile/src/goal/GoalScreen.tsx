import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GoalCard } from './components/GoalCard';
import { GoalBuilderFlow } from './GoalBuilderFlow';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SecondaryLink } from '../components/SecondaryLink';
import { Toast } from '../components/Toast';
import { getWeeklyGoal, getWeeklyGoalHistory, patchWeeklyGoal } from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { formatSwedishDate } from '../utils/formatDate';
import type { CurrentGoalResponse, GoalProgressSummary } from '../api/types';

interface GoalScreenProps {
  teamId: string;
}

type GoalViewState = 'card' | 'builder' | 'history';

/** Screen G1 — the "Mål" tab. Team-wide gold progress meter + captain-only
 * status-dependent actions, per docs/design/phase2-flows.md Part 3.
 * Self-contained fetch on mount, same pattern as HomeScreen/TeamScreen. */
export function GoalScreen({ teamId }: GoalScreenProps) {
  const [data, setData] = useState<CurrentGoalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<GoalViewState>('card');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [history, setHistory] = useState<GoalProgressSummary[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateBlocked, setActivateBlocked] = useState(false);

  const fetchGoal = useCallback(async () => {
    try {
      const response = await getWeeklyGoal(teamId);
      setData(response);
      setLoadError(null);
      setActivateBlocked(false);
    } catch {
      setLoadError('Kunde inte hämta lagets mål. Kolla din uppkoppling.');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void fetchGoal();
  }, [fetchGoal]);

  const handleOpenHistory = async () => {
    setView('history');
    setHistoryLoading(true);
    try {
      const response = await getWeeklyGoalHistory(teamId);
      setHistory(response.goals);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const doCancelGoal = async (goalId: string) => {
    setCancelling(true);
    try {
      await patchWeeklyGoal(teamId, goalId, { status: 'cancelled' });
      await fetchGoal();
    } catch {
      setToastMessage('Något gick fel. Testa igen.');
    } finally {
      setCancelling(false);
    }
  };

  const handleCancelGoal = (goal: GoalProgressSummary) => {
    Alert.alert(
      `Avbryta "${goal.title}"?`,
      'Loggad träning påverkas inte, men den räknas inte längre mot ett mål.',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Ja, avbryt', style: 'destructive', onPress: () => void doCancelGoal(goal.id) },
      ],
    );
  };

  const handleActivateDraft = async (goalId: string) => {
    setActivating(true);
    try {
      await patchWeeklyGoal(teamId, goalId, { status: 'active' });
      setToastMessage('Målet är aktiverat — laget ser det nu.');
      await fetchGoal();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_goal_already_exists') {
        setActivateBlocked(true);
        await fetchGoal();
      } else {
        setToastMessage('Något gick fel. Testa igen.');
      }
    } finally {
      setActivating(false);
    }
  };

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
        <Text style={styles.retryText} onPress={() => void fetchGoal()}>
          Försök igen
        </Text>
      </View>
    );
  }

  if (view === 'builder') {
    const editable =
      data.goal && data.goal.status === 'draft'
        ? {
            id: data.goal.id,
            title: data.goal.title,
            description: data.goal.description,
            targetMetric: data.goal.targetMetric,
            targetValue: data.goal.targetValue,
            startDate: data.goal.startDate,
            endDate: data.goal.endDate,
          }
        : null;

    return (
      <GoalBuilderFlow
        teamId={teamId}
        existingGoal={editable}
        hasActiveGoal={data.goal?.status === 'active'}
        onDone={(message) => {
          setToastMessage(message);
          setView('card');
          void fetchGoal();
        }}
        onCancel={() => setView('card')}
      />
    );
  }

  if (view === 'history') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.pageHeading}>Tidigare mål</Text>
        {historyLoading ? (
          <ActivityIndicator color={colors.gold} />
        ) : history && history.length > 0 ? (
          history.map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={styles.historyHeadRow}>
                <Text style={styles.historyTitle}>{item.title}</Text>
                <View
                  style={[
                    styles.pill,
                    item.status === 'completed' ? styles.pillCompleted : styles.pillCancelled,
                  ]}
                >
                  <Text style={styles.pillText}>
                    {item.status === 'completed' ? 'Avslutad' : 'Avbruten'}
                  </Text>
                </View>
              </View>
              <Text style={styles.historyDates}>
                {formatSwedishDate(item.startDate)} – {formatSwedishDate(item.endDate)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>Inga tidigare mål än.</Text>
        )}
        <SecondaryLink label="Tillbaka" onPress={() => setView('card')} />
      </ScrollView>
    );
  }

  const goal = data.goal;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.pageHeading}>Veckans mål 🎯</Text>

      {goal ? (
        <GoalCard
          title={goal.title}
          description={goal.description}
          progressMinutes={goal.progressMinutes}
          targetValue={goal.targetValue}
          percentComplete={goal.percentComplete}
          endDate={goal.endDate}
          goalMet={goal.goalMet}
        />
      ) : !data.viewerIsCaptain ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyHeading}>Inget mål just nu</Text>
          <Text style={styles.emptySub}>Er kapten sätter snart ett nytt mål för laget!</Text>
        </View>
      ) : null}

      {data.viewerIsCaptain ? (
        <View style={styles.captainActions}>
          {goal && goal.status === 'active' ? (
            <SecondaryButton
              label="Avbryt målet"
              loading={cancelling}
              onPress={() => handleCancelGoal(goal)}
            />
          ) : null}

          {goal && goal.status === 'draft' ? (
            <>
              <PrimaryButton label="Redigera" onPress={() => setView('builder')} />
              {activateBlocked ? (
                <Text style={styles.inlineExplain}>
                  Ni har redan ett aktivt mål. Det här sparas som utkast tills det är klart,
                  eller tills du avbryter det andra.
                </Text>
              ) : (
                <PrimaryButton
                  label="Aktivera nu"
                  loading={activating}
                  onPress={() => void handleActivateDraft(goal.id)}
                />
              )}
            </>
          ) : null}

          {!goal ? (
            <PrimaryButton label="+ Sätt veckans mål" onPress={() => setView('builder')} />
          ) : null}
        </View>
      ) : null}

      <SecondaryLink label="Se tidigare mål" onPress={() => void handleOpenHistory()} />

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
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
  captainActions: {
    gap: 10,
  },
  inlineExplain: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  historyRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 10,
    gap: 4,
  },
  historyHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    flexShrink: 1,
  },
  pill: {
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  pillCompleted: {
    backgroundColor: '#EAF6EE',
  },
  pillCancelled: {
    backgroundColor: colors.pausedBg,
  },
  pillText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.ink,
  },
  historyDates: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
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
