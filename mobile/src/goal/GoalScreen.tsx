import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { GoalCard } from './components/GoalCard';
import { GoalBuilderFlow } from './GoalBuilderFlow';
import { G1DTeammateStatus } from './screens/G1DTeammateStatus';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { SecondaryLink } from '../components/SecondaryLink';
import { Toast } from '../components/Toast';
import { LoadingOrRetry } from '../components/LoadingOrRetry';
import { getWeeklyGoal, getWeeklyGoalHistory, patchWeeklyGoal } from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { formatSwedishDate } from '../utils/formatDate';
import type { CurrentGoalResponse, GoalProgressSummary } from '../api/types';

interface GoalScreenProps {
  teamId: string;
  /** K1's ("Laget" tab) "Se vem som är klar →" shortcut lands directly on
   * Screen G1D instead of G1's card, per docs/design/
   * phase2.10-per-player-goal-flows.md — same "switch tab and open a
   * specific state" pattern K1's "Hantera veckans mål" shortcut already
   * uses. Defaults to 'card', the normal tab-bar entry point. */
  initialView?: 'card' | 'detail';
}

type GoalViewState = 'card' | 'builder' | 'history' | 'detail';

/** Screen G1 — the "Mål" tab. Per-player completion card + captain-only
 * status-dependent actions, per docs/adr/0015-weekly-goal-per-player-completion.md
 * and docs/design/phase2.10-per-player-goal-flows.md. Self-contained fetch
 * on mount, same pattern as HomeScreen/TeamScreen. */
export function GoalScreen({ teamId, initialView = 'card' }: GoalScreenProps) {
  const { t } = useTranslation('goal');
  const [data, setData] = useState<CurrentGoalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<GoalViewState>(initialView);
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
      setLoadError(t('g1.loadError'));
    } finally {
      setLoading(false);
    }
  }, [teamId, t]);

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
      setToastMessage(t('g1.genericErrorToast'));
    } finally {
      setCancelling(false);
    }
  };

  const handleCancelGoal = (goal: GoalProgressSummary) => {
    Alert.alert(
      t('g1.cancelConfirmTitle', { title: goal.title }),
      t('g1.cancelConfirmBody'),
      [
        { text: t('g1.cancelConfirmCancel'), style: 'cancel' },
        { text: t('g1.cancelConfirmConfirm'), style: 'destructive', onPress: () => void doCancelGoal(goal.id) },
      ],
    );
  };

  const handleActivateDraft = async (goalId: string) => {
    setActivating(true);
    try {
      await patchWeeklyGoal(teamId, goalId, { status: 'active' });
      setToastMessage(t('g1.activatedToast'));
      await fetchGoal();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_goal_already_exists') {
        setActivateBlocked(true);
        await fetchGoal();
      } else {
        setToastMessage(t('g1.genericErrorToast'));
      }
    } finally {
      setActivating(false);
    }
  };

  if (loading) {
    return <LoadingOrRetry loading spinnerColor={colors.gold} />;
  }

  if (loadError || !data) {
    return (
      <LoadingOrRetry
        loading={false}
        errorMessage={loadError ?? t('g1.genericError')}
        retryLabel={t('g1.retry')}
        onRetry={() => void fetchGoal()}
      />
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
        <Text style={styles.pageHeading}>{t('g1.historyHeading')}</Text>
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
                    {item.status === 'completed' ? t('g1.historyCompleted') : t('g1.historyCancelled')}
                  </Text>
                </View>
              </View>
              <Text style={styles.historyDates}>
                {formatSwedishDate(item.startDate)} – {formatSwedishDate(item.endDate)}
              </Text>
              {item.status === 'completed' ? (
                <Text style={styles.historyTally}>
                  {t('g1.historyTally', {
                    completed: item.completedPlayerCount,
                    eligible: item.eligiblePlayerCount,
                    bonus: item.bonusPointsAwarded ?? 0,
                  })}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>{t('g1.historyEmpty')}</Text>
        )}
        <SecondaryLink label={t('g1.back')} onPress={() => setView('card')} />
      </ScrollView>
    );
  }

  const goal = data.goal;

  if (view === 'detail' && goal) {
    return (
      <G1DTeammateStatus
        goalTitle={goal.title}
        players={goal.players}
        targetValue={goal.targetValue}
        targetUnit={goal.targetUnit}
        onBack={() => setView('card')}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.pageHeading}>{t('g1.pageHeading')}</Text>

      {goal ? (
        <GoalCard
          title={goal.title}
          description={goal.description}
          targetMetric={goal.targetMetric}
          targetUnit={goal.targetUnit}
          targetValue={goal.targetValue}
          eligiblePlayerCount={goal.eligiblePlayerCount}
          completedPlayerCount={goal.completedPlayerCount}
          percentComplete={goal.percentComplete}
          goalMet={goal.goalMet}
          endDate={goal.endDate}
          onSeeDetail={() => setView('detail')}
        />
      ) : !data.viewerIsCaptain ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyHeading}>{t('g1.emptyHeading')}</Text>
          <Text style={styles.emptySub}>{t('g1.emptySub')}</Text>
        </View>
      ) : null}

      {/* Fas 2.6c polish item 2 — promoted above captain-only actions and
          upgraded to SecondaryButton (from a plain text link), since
          "see the goals that are created" is Fas 2.6c's own first-class
          ask, not a footnote; same destination, just consistently
          prominent regardless of who's looking. */}
      <SecondaryButton label={t('g1.seeHistory')} onPress={() => void handleOpenHistory()} />

      {data.viewerIsCaptain ? (
        <View style={styles.captainActions}>
          {goal && goal.status === 'active' ? (
            <SecondaryButton
              label={t('g1.cancelGoal')}
              loading={cancelling}
              onPress={() => handleCancelGoal(goal)}
            />
          ) : null}

          {goal && goal.status === 'draft' ? (
            <>
              <PrimaryButton label={t('g1.editDraft')} onPress={() => setView('builder')} />
              {activateBlocked ? (
                <Text style={styles.inlineExplain}>{t('g1.activateBlockedExplain')}</Text>
              ) : (
                <PrimaryButton
                  label={t('g1.activateNow')}
                  loading={activating}
                  onPress={() => void handleActivateDraft(goal.id)}
                />
              )}
            </>
          ) : null}

          {!goal ? (
            <PrimaryButton label={t('g1.setNewGoal')} onPress={() => setView('builder')} />
          ) : null}
        </View>
      ) : null}

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
  historyTally: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.goldText,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
});
