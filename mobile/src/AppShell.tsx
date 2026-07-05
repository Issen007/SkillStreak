import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';

import { HomeScreen } from './home/HomeScreen';
import { TeamScreen } from './team/TeamScreen';
import { GoalScreen } from './goal/GoalScreen';
import { TabBar, TabKey } from './navigation/TabBar';
import { CatchUpBanner } from './components/CatchUpBanner';
import { getMe, getWeeklyGoal } from './api/endpoints';
import { getLastSeenBonusAwardedAt, setLastSeenBonusAwardedAt } from './api/localFlags';
import { ApiError } from './api/ApiError';
import { colors } from './theme/colors';

interface AppShellProps {
  onSessionInvalid: () => void;
}

/** Wraps the Phase 2 tab bar (Hem / Mål / Laget) around a plain
 * `activeTab` state — same "not a navigation library" posture as AppRoot
 * and OnboardingFlow, appropriate for this app's size per CLAUDE.md.
 *
 * Owns two cross-tab concerns no single tab screen can own by itself:
 * - `teamId`, which every tab besides Home needs for its `/teams/:teamId/...`
 *   calls but which only `GET /players/me` provides (fetched once here,
 *   lazily, rather than duplicated per tab).
 * - Screen G3's "catch-up" bonus-banner check, which has to run on every
 *   app open/foreground regardless of which tab happens to be open (the
 *   flow doc: "most likely Home"), so it can't live inside GoalScreen.
 *
 * The G2/G3 bonus-celebration split, end to end (read this if
 * `suppressNextCatchUp` below is confusing): when a team's weekly goal is
 * first crossed, exactly one training-log request is the one that crossed
 * it — the backend flags *that* response's `goalBonus` field, and nobody
 * else's. `HomeScreen` shows that one player the big `GoalBonusTakeover`
 * (Screen G2) locally, from the response it already has in hand — no
 * extra fetch. Every other teammate finds out passively: `checkForCatchUp`
 * below runs on every app open/foreground, and shows everyone (once each,
 * tracked per-device via `localFlags`) the smaller `CatchUpBanner` (Screen
 * G3) the first time it notices the goal now has a `bonusAwardedAt`.
 * Without `suppressNextCatchUp`, the *triggering* player would see both:
 * G2 immediately (from their own response), then G3 on their very next
 * foreground check (since the goal now looks "newly bonused" to
 * `checkForCatchUp` too, which has no way to know it was this same device
 * that caused it). `handleGoalBonusTriggered` — called by `HomeScreen`
 * right when it shows G2 — sets this one-shot flag so the *next*
 * `checkForCatchUp` run suppresses G3 once, then clears itself.
 */
export function AppShell({ onSessionInvalid }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [catchUpBanner, setCatchUpBanner] = useState<{ awardedPoints: number } | null>(null);

  // Set right before a G2 takeover's own weekly-goal re-check (see
  // `handleGoalBonusTriggered`) so the *triggering* player's own device
  // doesn't also show a redundant G3 catch-up banner for the bonus it just
  // watched live.
  const suppressNextCatchUp = useRef(false);
  const hasRunOnce = useRef(false);

  const ensureTeamId = useCallback(async (): Promise<string | null> => {
    if (teamId) return teamId;
    try {
      const me = await getMe();
      setTeamId(me.team.teamId);
      return me.team.teamId;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionInvalid();
      }
      // Any other failure here is non-fatal for the shell itself — Home's
      // own fetch will surface its own error state, and Team/Goal simply
      // stay on their loading spinner until the next foreground retry.
      return null;
    }
  }, [teamId, onSessionInvalid]);

  const checkForCatchUp = useCallback(async (resolvedTeamId: string) => {
    try {
      const response = await getWeeklyGoal(resolvedTeamId);
      const goal = response.goal;
      if (!goal || !goal.bonusAwardedAt) return;

      const lastSeen = await getLastSeenBonusAwardedAt(goal.id);
      if (lastSeen === goal.bonusAwardedAt) return;

      // Persisted immediately on first *display* (not dismissal), per the
      // flow doc's judgment call 9 — a kid who backgrounds the app
      // mid-banner should never see it twice.
      await setLastSeenBonusAwardedAt(goal.id, goal.bonusAwardedAt);

      if (suppressNextCatchUp.current) {
        // This device is the one whose training log just triggered the
        // bonus — Screen G2 already showed it there.
        suppressNextCatchUp.current = false;
        return;
      }

      setCatchUpBanner({ awardedPoints: goal.bonusPointsAwarded ?? 0 });
    } catch {
      // Non-critical — a missed check just means the banner shows on a
      // later open instead; never worth surfacing as an error.
    }
  }, []);

  const runCatchUpCheck = useCallback(async () => {
    const resolvedTeamId = await ensureTeamId();
    if (resolvedTeamId) await checkForCatchUp(resolvedTeamId);
  }, [ensureTeamId, checkForCatchUp]);

  useEffect(() => {
    hasRunOnce.current = true;
    void runCatchUpCheck();
  }, [runCatchUpCheck]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hasRunOnce.current) {
        void runCatchUpCheck();
      }
    });
    return () => subscription.remove();
  }, [runCatchUpCheck]);

  const handleGoalBonusTriggered = useCallback(() => {
    suppressNextCatchUp.current = true;
    // Persist "seen" promptly (rather than waiting for the next foreground
    // check) so a killed app doesn't re-show G3 on the next cold start.
    void runCatchUpCheck();
  }, [runCatchUpCheck]);

  const handleNavigateToGoalTab = useCallback(() => setActiveTab('goal'), []);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {activeTab === 'home' ? (
          <HomeScreen
            onSessionInvalid={onSessionInvalid}
            onGoalBonusTriggered={handleGoalBonusTriggered}
          />
        ) : null}

        {activeTab === 'goal' ? (
          teamId ? (
            <GoalScreen teamId={teamId} />
          ) : (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.flame} size="large" />
            </View>
          )
        ) : null}

        {activeTab === 'team' ? (
          teamId ? (
            <TeamScreen teamId={teamId} onManageGoal={handleNavigateToGoalTab} />
          ) : (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.flame} size="large" />
            </View>
          )
        ) : null}
      </View>

      {catchUpBanner ? (
        <CatchUpBanner
          awardedPoints={catchUpBanner.awardedPoints}
          onDismiss={() => setCatchUpBanner(null)}
        />
      ) : null}

      <TabBar activeTab={activeTab} onSelect={setActiveTab} goalTabDot={catchUpBanner !== null} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
