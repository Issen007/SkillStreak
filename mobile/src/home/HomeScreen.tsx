import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from './components/AppHeader';
import { StreakCard } from './components/StreakCard';
import { TeamPoolCard } from './components/TeamPoolCard';
import { WaitingCard } from './components/WaitingCard';
import { TrainedButton } from './components/TrainedButton';
import { ActivitySheet } from './components/ActivitySheet';
import { SuccessOverlay } from './components/SuccessOverlay';
import { GoalBonusTakeover } from './components/GoalBonusTakeover';
import { Toast } from '../components/Toast';
import { getMe, postTrainingLog } from '../api/endpoints';
import { ApiError, isConsentRequiredError } from '../api/ApiError';
import { clearSessionToken } from '../api/authStorage';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type { ActivityType, PlayerMeResponse } from '../api/types';

interface HomeScreenProps {
  /** Called when `GET /players/me` (or a training-log tap) reveals the
   * stored session token is no longer valid — sends the player back
   * through onboarding rather than showing a dead screen. */
  onSessionInvalid: () => void;
  /** Phase 2: called whenever a `POST /training-logs` response carries a
   * non-null `goalBonus` — i.e. this device is the one that triggered the
   * weekly-goal bonus (Screen G2, shown right here). Lets AppShell mark its
   * own client-persisted "last seen bonus" flag immediately, so this same
   * player never also sees Screen G3's catch-up banner for the same goal.
   * Optional so HomeScreen stays testable/usable standalone. */
  onGoalBonusTriggered?: () => void;
}

type SuccessMoment =
  | { kind: 'first-log'; streakCount: number; durationMinutes: number }
  | { kind: 'extra-log'; durationMinutes: number };

/** The real home screen — H1/H3/H4 states driven by `GET /players/me`,
 * H2's activity sheet, and H5/H6's success moments after
 * `POST /training-logs`. Two calls drive the whole screen, per
 * docs/api/phase1-contract.md's "no extra round-trip" principle. Phase 2
 * adds Screen G2 (the goal-bonus takeover) on top, driven by the same
 * `POST /training-logs` response's new `goalBonus` field. */
export function HomeScreen({ onSessionInvalid, onGoalBonusTriggered }: HomeScreenProps) {
  const [me, setMe] = useState<PlayerMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [successMoment, setSuccessMoment] = useState<SuccessMoment | null>(null);
  const [goalBonusMoment, setGoalBonusMoment] = useState<{ awardedPoints: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const hasLoadedOnce = useRef(false);

  // Poll-on-foreground and the manual "Kolla igen" refresh both call
  // fetchMe, and can race: whichever *response* arrives last would
  // otherwise win, not whichever *request* was issued last. This counter
  // lets a request discard its own result if a newer one has since been
  // issued, without needing a full cancellation library.
  const fetchRequestId = useRef(0);

  const fetchMe = useCallback(async () => {
    const requestId = ++fetchRequestId.current;
    try {
      const response = await getMe();
      if (requestId !== fetchRequestId.current) return;
      setMe(response);
      setLoadError(null);
    } catch (err) {
      if (requestId !== fetchRequestId.current) return;
      if (err instanceof ApiError && err.status === 401) {
        await clearSessionToken();
        onSessionInvalid();
        return;
      }
      setLoadError('Kunde inte hämta din data. Kolla din uppkoppling.');
    } finally {
      if (requestId !== fetchRequestId.current) return;
      setLoading(false);
      setManualRefreshing(false);
      hasLoadedOnce.current = true;
    }
  }, [onSessionInvalid]);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  // Poll-on-foreground, per the contract: no push notifications in Phase
  // 1, so re-fetching whenever the app comes back to the foreground is
  // how a "parent just approved" or "consent was revoked" state reaches
  // the player.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hasLoadedOnce.current) {
        void fetchMe();
      }
    });
    return () => subscription.remove();
  }, [fetchMe]);

  const handleManualRefresh = () => {
    setManualRefreshing(true);
    void fetchMe();
  };

  const handleOpenSheet = () => {
    setSheetError(null);
    setSheetOpen(true);
  };

  const handleSubmitLog = async (activityType: ActivityType, durationMinutes: number) => {
    setSheetLoading(true);
    setSheetError(null);
    try {
      const response = await postTrainingLog({ activityType, durationMinutes });
      setSheetOpen(false);
      setSheetLoading(false);

      setMe((prev) =>
        prev
          ? {
              ...prev,
              streak: {
                ...prev.streak,
                currentStreakCount: response.streak.currentStreakCount,
                longestStreakCount: response.streak.longestStreakCount,
                // Every log means "logged today" from here on, regardless
                // of whether this particular log was the day's first.
                alreadyLoggedToday: true,
              },
              teamPool: {
                ...prev.teamPool,
                pointsTotal: response.teamPool.pointsTotal,
                goalThreshold: response.teamPool.goalThreshold,
                percentComplete: response.teamPool.percentComplete,
              },
            }
          : prev,
      );

      if (response.goalBonus) {
        // Screen G2 — this log crossed the team's weekly-goal threshold.
        // Deliberately supersedes H5/H6 entirely (not layered on top): per
        // the flow doc, a same-day-first-log streak bump is "subordinate"
        // to this moment, not a second headline — StreakCard's own
        // count-up/bounce animation already fires quietly from the state
        // update above regardless, so nothing further is needed for that.
        setGoalBonusMoment({ awardedPoints: response.goalBonus.awardedPoints });
        onGoalBonusTriggered?.();
      } else if (response.streak.alreadyLoggedToday === false) {
        // This was the day's first log — State H5.
        setSuccessMoment({
          kind: 'first-log',
          streakCount: response.streak.currentStreakCount,
          durationMinutes,
        });
      } else {
        // An additional same-day log — State H6.
        setToastMessage(`Grymt jobbat! +${durationMinutes} min till lagets pott 🥇`);
      }
    } catch (err) {
      setSheetLoading(false);
      if (err instanceof ApiError && err.status === 401) {
        // Same recovery as fetchMe: a mid-session token invalidation
        // shouldn't become a dead end that only killing the app can escape.
        setSheetOpen(false);
        await clearSessionToken();
        onSessionInvalid();
        return;
      }
      if (isConsentRequiredError(err)) {
        // Stale-state edge case (Part 1 of the flow doc): the server is
        // the real gate, client state was stale. Close the sheet, toast
        // an explanation, and re-fetch to land back on the accurate
        // waiting/paused state.
        setSheetOpen(false);
        setToastMessage(
          'Vi behöver fortfarande godkännande innan du kan logga. Vi uppdaterar sidan åt dig.',
        );
        void fetchMe();
      } else {
        setSheetError('Något gick fel. Testa igen.');
      }
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (loadError || !me) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError ?? 'Något gick fel.'}</Text>
        <Text style={styles.retryText} onPress={() => void fetchMe()}>
          Försök igen
        </Text>
      </View>
    );
  }

  const isApproved = me.player.consentStatus === 'approved';

  return (
    <View style={styles.container}>
      <AppHeader screenName={me.player.screenName} avatarId={me.player.avatarId} />

      <View style={styles.content}>
        {goalBonusMoment ? (
          <GoalBonusTakeover
            awardedPoints={goalBonusMoment.awardedPoints}
            onDismiss={() => setGoalBonusMoment(null)}
          />
        ) : successMoment?.kind === 'first-log' ? (
          <SuccessOverlay
            bannerText={`🔥 Snyggt jobbat! ${successMoment.streakCount} dagar i rad.`}
            floatingText={`+${successMoment.durationMinutes} min till laget`}
            onDismiss={() => setSuccessMoment(null)}
          />
        ) : null}

        {isApproved ? (
          <StreakCard
            currentStreakCount={me.streak.currentStreakCount}
            alreadyLoggedToday={me.streak.alreadyLoggedToday}
          />
        ) : (
          <WaitingCard
            consentStatus={me.player.consentStatus}
            onRefresh={handleManualRefresh}
            refreshing={manualRefreshing}
          />
        )}

        <TrainedButton
          variant={!isApproved ? 'disabled' : me.streak.alreadyLoggedToday ? 'secondary' : 'primary'}
          onPress={isApproved ? handleOpenSheet : () => undefined}
        />

        <TeamPoolCard
          pointsTotal={me.teamPool.pointsTotal}
          goalThreshold={me.teamPool.goalThreshold}
          percentComplete={me.teamPool.percentComplete}
          seasonLabel={me.teamPool.seasonLabel}
        />
      </View>

      <ActivitySheet
        visible={sheetOpen}
        loading={sheetLoading}
        errorText={sheetError}
        onClose={() => {
          if (!sheetLoading) setSheetOpen(false);
        }}
        onSubmit={handleSubmitLog}
      />

      {toastMessage ? (
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: 56,
    paddingHorizontal: 18,
  },
  content: {
    marginTop: 16,
    gap: 13,
    position: 'relative',
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
