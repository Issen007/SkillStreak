import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader } from './components/AppHeader';
import { ProfileScreen } from './ProfileScreen';
import { StreakCard } from './components/StreakCard';
import { StreakGapBanner } from './components/StreakGapBanner';
import { StreakSaverCelebration } from './components/StreakSaverCelebration';
import { TeamPoolCard } from './components/TeamPoolCard';
import { WaitingCard } from './components/WaitingCard';
import { TrainedButton } from './components/TrainedButton';
import { ActivitySheet } from './components/ActivitySheet';
import { EvidenceFallbackSheet } from './components/EvidenceFallbackSheet';
import { TimerCountdownScreen } from './components/TimerCountdownScreen';
import type { TimerLogChoice } from './components/TimerCountdownScreen';
import { SuccessOverlay } from './components/SuccessOverlay';
import { GoalBonusTakeover } from './components/GoalBonusTakeover';
import { Toast } from '../components/Toast';
import { LoadingOrRetry } from '../components/LoadingOrRetry';
import { LeaderboardScreen } from '../leaderboard/LeaderboardScreen';
import {
  getClickOnlyAllowance,
  getMe,
  postTrainingLog,
  postTrainingTimer,
} from '../api/endpoints';
import { ApiError, isConsentRequiredError } from '../api/ApiError';
import { clearSessionToken } from '../api/authStorage';
import { skipRemainderOfToday } from '../api/trainingReminder';
import {
  activeTimerFromResponse,
  clearActiveTimer,
  loadActiveTimer,
  saveActiveTimer,
  scheduleTimerEndNotification,
} from '../api/trainingTimer';
import type { ActiveTimer } from '../api/trainingTimer';
import { colors } from '../theme/colors';
import { UploadFlow } from '../clips/upload/UploadFlow';
import type {
  ActivityType,
  ClickOnlyAllowance,
  CreateTrainingLogRequest,
  EvidenceChoice,
  PlayerMeResponse,
} from '../api/types';

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

/** `pointsAwarded` is null only if the server predates ADR-0038 and did
 * not send it — then no number is shown rather than a wrong one. */
type SuccessMoment = { kind: 'first-log'; streakCount: number; pointsAwarded: number | null };

/** The real home screen — H1/H3/H4 states driven by `GET /players/me`,
 * H2's activity sheet, and H5/H6's success moments after
 * `POST /training-logs`. Two calls drive the whole screen, per
 * docs/api/phase1-contract.md's "no extra round-trip" principle. Phase 2
 * adds Screen G2 (the goal-bonus takeover) on top, driven by the same
 * `POST /training-logs` response's new `goalBonus` field. */
export function HomeScreen({ onSessionInvalid, onGoalBonusTriggered }: HomeScreenProps) {
  const { t } = useTranslation('home');
  const [me, setMe] = useState<PlayerMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /*
   * A translation *key*, not a translated string.
   *
   * `fetchMe` is memoised and would otherwise capture the `t` that existed
   * when it was created. The language changes after that: AppShell calls
   * `changeLanguage(me.player.locale)` once the player loads, and
   * onboarding lets the child pick one. So a failure after that point
   * rendered its message in the device's language rather than the one the
   * player chose — visible only to the non-Swedish users the nine locales
   * exist for. Holding the key and translating at render also means the
   * message follows a language change while it is still on screen.
   */
  const [loadErrorKey, setLoadErrorKey] = useState<
    'homeScreen.loadError' | null
  >(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [successMoment, setSuccessMoment] = useState<SuccessMoment | null>(null);
  const [goalBonusMoment, setGoalBonusMoment] = useState<{ awardedPoints: number } | null>(null);
  // A log waiting on its evidence clip. Held here rather than inside the
  // sheet because the sheet closes when the upload flow takes over.
  /**
   * A session whose upload did not finish.
   *
   * Before this existed, abandoning the upload threw the session away
   * entirely: the child trained, chose "with video", hit a flaky
   * connection, and landed back on the home screen with nothing logged and
   * no explanation. "You trained and got nothing" is the exact message
   * ADR-0025's floor-of-1 rule exists to avoid, and a bad connection is
   * not the child's fault.
   *
   * The evidence rule is untouched — this logs at the click-only tier,
   * because no clip exists. It offers the honest lesser outcome instead of
   * silently discarding the work.
   */
  const [abandonedEvidenceLog, setAbandonedEvidenceLog] = useState<{
    activityType: ActivityType;
    durationMinutes: number;
    /**
     * Carried through the retry. Dropping it silently downgraded
     * `video_shared` to `video` on the way back — the clip the child chose
     * to share never reached the team, and a 20-minute session paid 24
     * points instead of 28, with nothing saying the choice had changed.
     */
    evidence: EvidenceChoice;
    /** ADR-0038 Decision 5 — a timed session whose clip did not finish
     * still has its timer, so "log anyway" lands at ×1, not ×0.1. */
    timerId?: string;
  } | null>(null);

  const [pendingEvidenceLog, setPendingEvidenceLog] = useState<{
    activityType: ActivityType;
    durationMinutes: number;
    evidence: EvidenceChoice;
    timerId?: string;
  } | null>(null);

  /*
   * docs/adr/0038 — the running countdown timer. Its own state, separate
   * from the sheet's: the timer outlives the sheet, the app being
   * backgrounded and the app being killed (persisted in trainingTimer.ts
   * and restored below), and a log written from it reports its errors on
   * the countdown screen, which is what is on screen at that moment.
   */
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [timerLoading, setTimerLoading] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);
  /** Hides the countdown while a timed session's clip is being uploaded
   * and logged, so it does not flash back mid-way. */
  const [timerHidden, setTimerHidden] = useState(false);
  // ADR-0038 Decision 4 — shown in the picker before the choice. null =
  // unknown, and the picker then shows no allowance line at all.
  const [clickOnlyAllowance, setClickOnlyAllowance] = useState<ClickOnlyAllowance | null>(
    null,
  );
  // docs/design/streak-savers-ui.md §3 — the "streak saved!" celebration,
  // triggered once from a training-log response's `streak.streakSaverSpent
  // > 0`, inserted into the same mutually-exclusive overlay chain as
  // `goalBonusMoment`/`successMoment` (goalBonus still wins outright, §3.1).
  const [streakSaverMoment, setStreakSaverMoment] = useState<{
    currentStreakCount: number;
    bankedStreakSaverCount: number;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Longer messages (the 0-points explanation) need longer to read.
  const [toastDurationMs, setToastDurationMs] = useState<number | undefined>(undefined);
  // Screen LB1/LB2 (Fas 2.7) — a local view toggle to reach the full
  // leaderboard, same lightweight "no navigation library" pattern
  // GoalScreen/TeamScreen already use for their own sub-views. 'profile'
  // added Fas 4.1 (docs/adr/0012-profile-page-and-contact-email-change.md),
  // reached via AppHeader's avatar circle.
  const [view, setView] = useState<'home' | 'leaderboard' | 'profile'>('home');

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
      setLoadErrorKey(null);
    } catch (err) {
      if (requestId !== fetchRequestId.current) return;
      if (err instanceof ApiError && err.status === 401) {
        await clearSessionToken();
        onSessionInvalid();
        return;
      }
      setLoadErrorKey('homeScreen.loadError');
    } finally {
      if (requestId !== fetchRequestId.current) return;
      setLoading(false);
      setManualRefreshing(false);
      hasLoadedOnce.current = true;
    }
    // `t` is deliberately absent: nothing here translates any more.
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

  /*
   * Restore a timer that was running when the app was last closed. The
   * countdown recomputes from the stored server `endsAt`, so a timer that
   * finished while the app was dead simply shows as finished. Re-arming
   * the notification is idempotent (fixed identifier) and covers an OS
   * that dropped it; it never asks for permission.
   */
  useEffect(() => {
    let cancelled = false;
    void loadActiveTimer().then((timer) => {
      if (cancelled || !timer) return;
      setActiveTimer(timer);
      void scheduleTimerEndNotification(timer, {
        title: t('trainingTimer.notifTitle'),
        body: t('trainingTimer.notifBody'),
      });
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: `t` changing language must not re-restore the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRefresh = () => {
    setManualRefreshing(true);
    void fetchMe();
  };

  const handleOpenSheet = () => {
    setSheetError(null);
    setSheetOpen(true);
    // Fresh every open: the week may have rolled over, or another device
    // may have logged. A failure leaves the last known value (or none).
    getClickOnlyAllowance()
      .then(setClickOnlyAllowance)
      .catch(() => undefined);
  };

  const discardTimer = () => {
    setActiveTimer(null);
    setTimerError(null);
    setTimerHidden(false);
    void clearActiveTimer();
  };

  /** docs/adr/0038 Decision 2 — the server starts the clock; the phone
   * only displays it. */
  const startTimer = async (activityType: ActivityType, plannedMinutes: number) => {
    setSheetLoading(true);
    setSheetError(null);
    try {
      const response = await postTrainingTimer({ activityType, plannedMinutes });
      const timer = activeTimerFromResponse(response, activityType);
      await saveActiveTimer(timer);
      void scheduleTimerEndNotification(timer, {
        title: t('trainingTimer.notifTitle'),
        body: t('trainingTimer.notifBody'),
      });
      setTimerError(null);
      setTimerHidden(false);
      setActiveTimer(timer);
      setSheetOpen(false);
      setSheetLoading(false);
    } catch (err) {
      setSheetLoading(false);
      if (err instanceof ApiError && err.status === 401) {
        setSheetOpen(false);
        await clearSessionToken();
        onSessionInvalid();
        return;
      }
      if (isConsentRequiredError(err)) {
        setSheetOpen(false);
        setToastDurationMs(undefined);
        setToastMessage(t('homeScreen.consentRequiredToast'));
        void fetchMe();
      } else {
        setSheetError(t('shared.genericErrorTryAgain'));
      }
    }
  };

  /** From the countdown's finish step. A clip goes through the same
   * upload-then-log path as an untimed video log, carrying the timer. */
  const handleTimerLog = (minutesDone: number, choice: TimerLogChoice) => {
    if (!activeTimer) return;
    const base = {
      activityType: activeTimer.activityType,
      durationMinutes: minutesDone,
      timerId: activeTimer.timerId,
    };
    if (choice === 'timer') {
      void writeTrainingLog(base);
      return;
    }
    setTimerError(null);
    setTimerHidden(true);
    setPendingEvidenceLog({ ...base, evidence: choice });
  };

  /**
   * docs/adr/0025 — a video-backed log is two steps that must land as one
   * outcome. The clip has to exist and be published before the log can
   * reference it, so the upload runs first and the log is written from its
   * success callback.
   *
   * Deliberately NOT logged optimistically before the upload: a log
   * written first would have to be re-rated afterwards, which is exactly
   * the "points changed after the fact" shape Decision 1 rejects. If the
   * child abandons the upload, nothing is logged and nothing is claimed —
   * they simply land back on the home screen and can log a plain session
   * instead.
   */
  const handleSubmitLog = async (
    activityType: ActivityType,
    durationMinutes: number,
    evidence: EvidenceChoice,
  ) => {
    if (evidence === 'timer') {
      await startTimer(activityType, durationMinutes);
      return;
    }
    if (evidence !== 'none') {
      setSheetOpen(false);
      setPendingEvidenceLog({ activityType, durationMinutes, evidence });
      return;
    }
    await writeTrainingLog({ activityType, durationMinutes });
  };

  const writeTrainingLog = async (body: CreateTrainingLogRequest) => {
    // A timed log is written from the countdown screen, so its loading and
    // error states belong there; everything else reports on the sheet.
    const fromTimer = body.timerId !== undefined;
    const setLoadingFor = fromTimer ? setTimerLoading : setSheetLoading;
    const setErrorFor = fromTimer ? setTimerError : setSheetError;
    setLoadingFor(true);
    setErrorFor(null);
    try {
      const response = await postTrainingLog(body);
      setSheetOpen(false);
      setLoadingFor(false);
      if (fromTimer) {
        // A timer verifies one log and is then consumed (ADR-0038).
        setActiveTimer(null);
        setTimerHidden(false);
        void clearActiveTimer();
      }
      if (response.clickOnlyAllowance) {
        setClickOnlyAllowance(response.clickOnlyAllowance);
      }
      const pointsAwarded =
        typeof response.pointsAwarded === 'number' ? response.pointsAwarded : null;
      // ADR-0033 Decision 2: nothing is sent on a day already logged.
      // Fire-and-forget — a reminder that fails to reschedule is a small
      // annoyance, and it must never turn a successful log into an error.
      void skipRemainderOfToday({
        title: t('trainingReminder.notifTitle'),
        body: t('trainingReminder.notifBody'),
      });

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
                // docs/design/streak-savers-ui.md §3.2 fix 1 — otherwise
                // StreakCard's badge (§1) shows a stale count until the
                // next full `me` fetch (app foreground), even though the
                // updated number already came back on this response.
                bankedStreakSaverCount: response.streak.bankedStreakSaverCount,
                // docs/design/streak-savers-ui.md §3.2 fix 2 — a
                // successful log by definition just resolved whatever gap
                // existed, so this is always correct to null out here;
                // without it StreakGapBanner (§2) would keep rendering
                // with stale, now-resolved values after the very log that
                // resolved them.
                pendingStreakGap: null,
              },
              teamPool: {
                ...prev.teamPool,
                pointsTotal: response.teamPool.pointsTotal,
                // Fas 2.7 (ADR-0008 Decision 3): rank is deliberately not
                // in the training-log response (hot-path reasoning) — this
                // device's rank/teamCount go stale until the next `me`/
                // dashboard fetch, same as every other post-log state this
                // screen doesn't patch synchronously.
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
      } else if (response.streak.streakSaverSpent > 0) {
        // docs/design/streak-savers-ui.md §3.1 — inserted second in the
        // precedence chain, after goalBonus (still wins outright — kept
        // as-is, see §3.1's own reasoning) and before H5/H6.
        setStreakSaverMoment({
          currentStreakCount: response.streak.currentStreakCount,
          bankedStreakSaverCount: response.streak.bankedStreakSaverCount,
        });
      } else if (response.streak.alreadyLoggedToday === false) {
        // This was the day's first log — State H5.
        setSuccessMoment({
          kind: 'first-log',
          streakCount: response.streak.currentStreakCount,
          pointsAwarded,
        });
      } else if (pointsAwarded !== 0) {
        // An additional same-day log — State H6.
        setToastDurationMs(undefined);
        setToastMessage(
          pointsAwarded === null
            ? t('homeScreen.successFloatingNoPoints')
            : t('homeScreen.extraLogPointsToast', { points: pointsAwarded }),
        );
      }

      /*
       * ADR-0038 Decision 4 — a click-only log past the weekly allowance
       * pays 0. Say why, kindly, whichever celebration is showing: the
       * session is saved and the streak counts, and the timer is how to
       * earn points again. A silent zero would read as the app being
       * broken or as a punishment, and this audience is 9–13.
       */
      if (pointsAwarded === 0) {
        setToastDurationMs(6000);
        setToastMessage(
          t('homeScreen.zeroPointsToast', {
            limit: response.clickOnlyAllowance?.limit ?? 3,
          }),
        );
      }
    } catch (err) {
      setLoadingFor(false);
      if (err instanceof ApiError && err.status === 401) {
        // Same recovery as fetchMe: a mid-session token invalidation
        // shouldn't become a dead end that only killing the app can escape.
        setSheetOpen(false);
        if (fromTimer) discardTimer();
        await clearSessionToken();
        onSessionInvalid();
        return;
      }
      // Whatever went wrong, the countdown comes back so the error is seen.
      setTimerHidden(false);
      if (fromTimer && isConsentRequiredError(err)) {
        // The countdown covers the screen, so a toast would be hidden.
        setTimerError(t('homeScreen.consentRequiredToast'));
        void fetchMe();
      } else if (
        fromTimer &&
        err instanceof ApiError &&
        err.code === 'training_timer_too_short'
      ) {
        // The one timer failure the child can fix by carrying on: the
        // server keeps the timer open. Only reachable if this phone's
        // clock disagrees with the server's about the first minute.
        setTimerError(t('trainingTimer.tooShort'));
      } else if (
        fromTimer &&
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500
      ) {
        // Too old, already used, or replaced by a timer started on another
        // device. The training still happened — the copy points to logging
        // it the ordinary way.
        setTimerError(t('trainingTimer.rejected'));
      } else if (fromTimer) {
        setTimerError(t('shared.genericErrorTryAgain'));
      } else if (isConsentRequiredError(err)) {
        // Stale-state edge case (Part 1 of the flow doc): the server is
        // the real gate, client state was stale. Close the sheet, toast
        // an explanation, and re-fetch to land back on the accurate
        // waiting/paused state.
        setSheetOpen(false);
        setToastDurationMs(undefined);
        setToastMessage(t('homeScreen.consentRequiredToast'));
        void fetchMe();
      } else {
        setSheetError(t('shared.genericErrorTryAgain'));
      }
    }
  };

  if (loading) {
    return <LoadingOrRetry loading />;
  }

  if (loadErrorKey || !me) {
    return (
      <LoadingOrRetry
        loading={false}
        errorMessage={t(loadErrorKey ?? 'shared.genericError')}
        retryLabel={t('shared.retry')}
        onRetry={() => void fetchMe()}
      />
    );
  }

  if (view === 'leaderboard') {
    return <LeaderboardScreen teamId={me.team.teamId} onBack={() => setView('home')} />;
  }

  if (view === 'profile') {
    return (
      <ProfileScreen
        screenName={me.player.screenName}
        onBack={() => setView('home')}
        onLogout={onSessionInvalid}
        teamId={me.team.teamId}
        playerId={me.player.id}
        isSelfVerification={me.player.isSelfVerification}
      />
    );
  }

  // Two independent gates, added 2026-07-27 (team-join approval alongside
  // the existing parental-consent one) — both must clear before gameplay
  // unlocks. WaitingCard shows whichever is still pending (or both).
  const isApproved =
    me.player.consentStatus === 'approved' &&
    me.player.teamJoinStatus === 'approved';

  /**
   * The upload owns the whole screen, exactly as it does on the Shorts tab.
   *
   * **This used to be rendered inline**, as a sibling below `styles.content`
   * inside the home container — and that was the bug the project owner hit
   * on 2026-08-23: picking "with a video" closed the activity sheet and
   * appeared to do nothing at all.
   *
   * Nothing was broken in the flow itself. V4-V7 are full-screen views
   * (`flex: 1`, their own `paddingTop: 64`) written on the assumption that
   * they ARE the screen, which is true where `ClipsScreen` early-returns
   * them and was false here: the home content had already taken the
   * vertical space, so the picker rendered into whatever was left — below
   * the fold, effectively invisible. Every other overlay on this screen is
   * a `<Modal>`, which is why none of them showed the same symptom.
   *
   * The consequence was worse than a cosmetic one. Nothing is logged until
   * `onPublished` fires, so a child who chose video and saw the sheet close
   * had **no session recorded at all** — not the x0.1 they would have got
   * by choosing "no proof", and no way to tell, because the app looked like
   * it had accepted the log.
   *
   * An early return rather than wrapping it in a `<Modal>`: it matches the
   * one place this flow is known to work, and it is what V4-V7's own
   * layout already expects.
   */
  if (pendingEvidenceLog) {
    return (
      <UploadFlow
        teamId={me.team.teamId}
        viewerPlayerId={me.player.id}
        onCancel={() => {
          // The child backed out, or the upload failed. Their session is
          // still real, so offer to keep it rather than silently dropping
          // it — see EvidenceFallbackSheet below.
          setAbandonedEvidenceLog(pendingEvidenceLog);
          setPendingEvidenceLog(null);
        }}
        onConsentRevoked={() => {
          setPendingEvidenceLog(null);
          // A timed session keeps its timer; the countdown comes back.
          setTimerHidden(false);
          void fetchMe();
        }}
        onPublished={(clipId) => {
          const pending = pendingEvidenceLog;
          setPendingEvidenceLog(null);
          if (!pending || !clipId) return;
          void writeTrainingLog({
            activityType: pending.activityType,
            durationMinutes: pending.durationMinutes,
            evidenceClipId: clipId,
            sharedWithTeam: pending.evidence === 'video_shared',
            timerId: pending.timerId,
          });
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader
        screenName={me.player.screenName}
        avatarId={me.player.avatarId}
        onAvatarPress={() => setView('profile')}
      />

      <View style={styles.content}>
        {goalBonusMoment ? (
          <GoalBonusTakeover
            awardedPoints={goalBonusMoment.awardedPoints}
            onDismiss={() => setGoalBonusMoment(null)}
          />
        ) : streakSaverMoment ? (
          <StreakSaverCelebration
            currentStreakCount={streakSaverMoment.currentStreakCount}
            bankedStreakSaverCount={streakSaverMoment.bankedStreakSaverCount}
            onDismiss={() => setStreakSaverMoment(null)}
          />
        ) : successMoment?.kind === 'first-log' ? (
          <SuccessOverlay
            bannerText={t('homeScreen.successBanner', { count: successMoment.streakCount })}
            floatingText={
              successMoment.pointsAwarded === null || successMoment.pointsAwarded === 0
                ? t('homeScreen.successFloatingNoPoints')
                : t('homeScreen.successFloatingPoints', {
                    points: successMoment.pointsAwarded,
                  })
            }
            onDismiss={() => setSuccessMoment(null)}
          />
        ) : null}

        {isApproved ? (
          <>
            <StreakCard
              currentStreakCount={me.streak.currentStreakCount}
              alreadyLoggedToday={me.streak.alreadyLoggedToday}
              bankedStreakSaverCount={me.streak.bankedStreakSaverCount}
            />
            {me.streak.pendingStreakGap ? (
              <StreakGapBanner
                missedDayCount={me.streak.pendingStreakGap.missedDayCount}
                coverableWithBankedSavers={me.streak.pendingStreakGap.coverableWithBankedSavers}
                longestStreakCount={me.streak.longestStreakCount}
              />
            ) : null}
          </>
        ) : (
          <WaitingCard
            consentStatus={me.player.consentStatus}
            isSelfVerification={me.player.isSelfVerification}
            teamJoinStatus={me.player.teamJoinStatus}
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
          rank={me.teamPool.rank}
          teamCount={me.teamPool.teamCount}
          effortRank={me.teamPool.effortRank}
          onPress={() => setView('leaderboard')}
        />
      </View>

      <EvidenceFallbackSheet
        visible={abandonedEvidenceLog !== null}
        onTryAgain={() => {
          const retry = abandonedEvidenceLog;
          setAbandonedEvidenceLog(null);
          if (retry) {
            // Back to the upload with the same session AND the same
            // sharing choice — re-picking `video` here was what silently
            // downgraded a `video_shared` session on every retry.
            setPendingEvidenceLog(retry);
          }
        }}
        onLogAnyway={() => {
          const fallback = abandonedEvidenceLog;
          setAbandonedEvidenceLog(null);
          if (!fallback) return;
          if (fallback.timerId) {
            // Timed session: logs at ×1 with the timer, and any error shows
            // on the countdown screen, which comes back for it.
            void writeTrainingLog({
              activityType: fallback.activityType,
              durationMinutes: fallback.durationMinutes,
              timerId: fallback.timerId,
            });
            return;
          }
          // Reopen the sheet so writeTrainingLog's error has somewhere to
          // land. Its failure path writes to `sheetError`, which only
          // ActivitySheet renders and only while it is open — and the
          // sheet was closed when the upload flow took over. Without this
          // a failed "log it anyway" is silent, which is verbatim the bug
          // EvidenceFallbackSheet exists to prevent.
          setSheetOpen(true);
          // No evidenceClipId, so the server resolves this to CLICK_ONLY.
          // The client never claims a tier; it only ever supplies proof.
          void writeTrainingLog({
            activityType: fallback.activityType,
            durationMinutes: fallback.durationMinutes,
          });
        }}
        onDismiss={() => {
          setAbandonedEvidenceLog(null);
          setTimerHidden(false);
        }}
      />

      <ActivitySheet
        visible={sheetOpen}
        loading={sheetLoading}
        errorText={sheetError}
        clickOnlyAllowance={clickOnlyAllowance}
        onClose={() => {
          if (!sheetLoading) setSheetOpen(false);
        }}
        onSubmit={handleSubmitLog}
      />

      {activeTimer ? (
        <TimerCountdownScreen
          visible={!timerHidden && abandonedEvidenceLog === null}
          timer={activeTimer}
          loading={timerLoading}
          errorText={timerError}
          onLog={handleTimerLog}
          onDiscard={discardTimer}
        />
      ) : null}

      {toastMessage ? (
        <Toast
          message={toastMessage}
          durationMs={toastDurationMs}
          onDismiss={() => setToastMessage(null)}
        />
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
});
