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
import { SuccessOverlay } from './components/SuccessOverlay';
import { GoalBonusTakeover } from './components/GoalBonusTakeover';
import { Toast } from '../components/Toast';
import { LoadingOrRetry } from '../components/LoadingOrRetry';
import { LeaderboardScreen } from '../leaderboard/LeaderboardScreen';
import { getMe, postTrainingLog } from '../api/endpoints';
import { ApiError, isConsentRequiredError } from '../api/ApiError';
import { clearSessionToken } from '../api/authStorage';
import { colors } from '../theme/colors';
import { UploadFlow } from '../clips/upload/UploadFlow';
import type {
  ActivityType,
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
  const { t } = useTranslation('home');
  const [me, setMe] = useState<PlayerMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [successMoment, setSuccessMoment] = useState<SuccessMoment | null>(null);
  const [goalBonusMoment, setGoalBonusMoment] = useState<{ awardedPoints: number } | null>(null);
  // A log waiting on its evidence clip. Held here rather than inside the
  // sheet because the sheet closes when the upload flow takes over.
  const [pendingEvidenceLog, setPendingEvidenceLog] = useState<{
    activityType: ActivityType;
    durationMinutes: number;
    evidence: EvidenceChoice;
  } | null>(null);
  // docs/design/streak-savers-ui.md §3 — the "streak saved!" celebration,
  // triggered once from a training-log response's `streak.streakSaverSpent
  // > 0`, inserted into the same mutually-exclusive overlay chain as
  // `goalBonusMoment`/`successMoment` (goalBonus still wins outright, §3.1).
  const [streakSaverMoment, setStreakSaverMoment] = useState<{
    currentStreakCount: number;
    bankedStreakSaverCount: number;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
      setLoadError(null);
    } catch (err) {
      if (requestId !== fetchRequestId.current) return;
      if (err instanceof ApiError && err.status === 401) {
        await clearSessionToken();
        onSessionInvalid();
        return;
      }
      setLoadError(t('homeScreen.loadError'));
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
    if (evidence !== 'none') {
      setSheetOpen(false);
      setPendingEvidenceLog({ activityType, durationMinutes, evidence });
      return;
    }
    await writeTrainingLog({ activityType, durationMinutes });
  };

  const writeTrainingLog = async (body: CreateTrainingLogRequest) => {
    const { durationMinutes } = body;
    setSheetLoading(true);
    setSheetError(null);
    try {
      const response = await postTrainingLog(body);
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
          durationMinutes,
        });
      } else {
        // An additional same-day log — State H6.
        setToastMessage(t('homeScreen.extraLogToast', { minutes: durationMinutes }));
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

  if (loadError || !me) {
    return (
      <LoadingOrRetry
        loading={false}
        errorMessage={loadError ?? t('shared.genericError')}
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
      />
    );
  }

  // Two independent gates, added 2026-07-27 (team-join approval alongside
  // the existing parental-consent one) — both must clear before gameplay
  // unlocks. WaitingCard shows whichever is still pending (or both).
  const isApproved =
    me.player.consentStatus === 'approved' &&
    me.player.teamJoinStatus === 'approved';

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
            floatingText={t('homeScreen.successFloatingText', {
              minutes: successMoment.durationMinutes,
            })}
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

      {pendingEvidenceLog ? (
        <UploadFlow
          teamId={me.team.teamId}
          viewerPlayerId={me.player.id}
          onCancel={() => setPendingEvidenceLog(null)}
          onConsentRevoked={() => {
            setPendingEvidenceLog(null);
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
            });
          }}
        />
      ) : null}

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
});
