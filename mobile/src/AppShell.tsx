import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';

import { HomeScreen } from './home/HomeScreen';
import { TeamScreen } from './team/TeamScreen';
import { GoalScreen } from './goal/GoalScreen';
import { ChatScreen } from './chat/ChatScreen';
import { TabBar, TabKey } from './navigation/TabBar';
import { CatchUpBanner } from './components/CatchUpBanner';
import { CaptainBanner } from './components/CaptainBanner';
import { getChatMessages, getMe, getTeamDashboard, getWeeklyGoal } from './api/endpoints';
import {
  getChatLastViewedAt,
  getLastKnownIsCaptain,
  getLastSeenBonusAwardedAt,
  setLastKnownIsCaptain,
  setLastSeenBonusAwardedAt,
} from './api/localFlags';
import { ApiError } from './api/ApiError';
import { colors } from './theme/colors';

interface AppShellProps {
  onSessionInvalid: () => void;
}

type CaptainBannerState = { variant: 'promoted' | 'demoted' };

/** Wraps the Phase 2.6b tab bar (Hem / Chatt / Mål / Laget) around a plain
 * `activeTab` state — same "not a navigation library" posture as AppRoot
 * and OnboardingFlow, appropriate for this app's size per CLAUDE.md.
 *
 * Owns several cross-tab concerns no single tab screen can own by itself:
 * - `teamId`/`playerId`, which every tab besides Home needs (for its own
 *   `/teams/:teamId/...` calls, or — for `playerId` — to tell "is this my
 *   own message/row") but which only `GET /players/me` provides (fetched
 *   once here, lazily, rather than duplicated per tab).
 * - Screen G3's "catch-up" bonus-banner check, Screen K5's captaincy-
 *   change check, and the "Chatt" tab's unread-dot check, all of which
 *   have to run on every app open/foreground regardless of which tab
 *   happens to be open (the flow docs: "most likely Home"), so none of
 *   them can live inside a single tab screen.
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
 *
 * Screen K5 (Fas 2.6a) reuses this exact diff-against-a-locally-persisted-
 * value mechanism for captaincy changes: `checkForCaptainBanner` compares
 * the dashboard's fresh `viewerIsCaptain` against this device's last-known
 * value. `handleCaptainTransferred` — called by `TeamScreen` right when
 * Screen K4's own transfer confirmation lands — suppresses the (optional,
 * cuttable) "handed off" banner on the device that just performed the
 * transfer, since that device already got its own toast directly from K4.
 */
export function AppShell({ onSessionInvalid }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [catchUpBanner, setCatchUpBanner] = useState<{ awardedPoints: number } | null>(null);
  const [captainBanner, setCaptainBanner] = useState<CaptainBannerState | null>(null);
  const [chatUnread, setChatUnread] = useState(false);

  // Set right before a G2 takeover's own weekly-goal re-check (see
  // `handleGoalBonusTriggered`) so the *triggering* player's own device
  // doesn't also show a redundant G3 catch-up banner for the bonus it just
  // watched live.
  const suppressNextCatchUp = useRef(false);
  // Same idea for Screen K5's optional "handed off" banner — set by
  // `handleCaptainTransferred`.
  const suppressNextCaptainBanner = useRef(false);
  const hasRunOnce = useRef(false);

  const ensureIdentity = useCallback(async (): Promise<{
    teamId: string;
    playerId: string;
  } | null> => {
    if (teamId && playerId) return { teamId, playerId };
    try {
      const me = await getMe();
      setTeamId(me.team.teamId);
      setPlayerId(me.player.id);
      return { teamId: me.team.teamId, playerId: me.player.id };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionInvalid();
      }
      // Any other failure here is non-fatal for the shell itself — Home's
      // own fetch will surface its own error state, and Team/Goal/Chat
      // simply stay on their loading spinner until the next foreground
      // retry.
      return null;
    }
  }, [teamId, playerId, onSessionInvalid]);

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

  // Screen K5 (Fas 2.6a) — see this file's class comment.
  const checkForCaptainBanner = useCallback(async (resolvedTeamId: string) => {
    try {
      const dashboard = await getTeamDashboard(resolvedTeamId);
      const isCaptainNow = dashboard.viewerIsCaptain;
      const lastKnown = await getLastKnownIsCaptain(resolvedTeamId);

      if (lastKnown === null) {
        // First time ever recording this team's captain status on this
        // device — just record the baseline, no banner. Without this, a
        // fresh install of an existing captain's app would mistake "always
        // was captain" for "just became captain."
        await setLastKnownIsCaptain(resolvedTeamId, isCaptainNow);
        return;
      }

      if (!lastKnown && isCaptainNow) {
        await setLastKnownIsCaptain(resolvedTeamId, true);
        setCaptainBanner({ variant: 'promoted' });
        return;
      }

      if (lastKnown && !isCaptainNow) {
        await setLastKnownIsCaptain(resolvedTeamId, false);
        if (suppressNextCaptainBanner.current) {
          suppressNextCaptainBanner.current = false;
        } else {
          setCaptainBanner({ variant: 'demoted' });
        }
      }
    } catch {
      // Non-critical — same posture as checkForCatchUp above.
    }
  }, []);

  // Fas 2.6b's "Chatt" tab unread dot — a single lightweight check per
  // foreground/open (not a continuous poll; that only runs while the
  // Chatt tab itself is mounted, per ADR-0007 Decision 5), asking "is
  // there anything newer than what this device last viewed."
  const checkForUnreadChat = useCallback(async (resolvedTeamId: string) => {
    try {
      const lastViewed = await getChatLastViewedAt(resolvedTeamId);
      const response = await getChatMessages(resolvedTeamId, {
        after: lastViewed ?? undefined,
        limit: 1,
      });
      if (response.messages.length > 0) {
        setChatUnread(true);
      }
    } catch {
      // Non-critical — same posture as the other foreground checks above.
    }
  }, []);

  const runForegroundChecks = useCallback(async () => {
    const identity = await ensureIdentity();
    if (!identity) return;
    await Promise.all([
      checkForCatchUp(identity.teamId),
      checkForCaptainBanner(identity.teamId),
      checkForUnreadChat(identity.teamId),
    ]);
  }, [ensureIdentity, checkForCatchUp, checkForCaptainBanner, checkForUnreadChat]);

  useEffect(() => {
    hasRunOnce.current = true;
    void runForegroundChecks();
  }, [runForegroundChecks]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hasRunOnce.current) {
        void runForegroundChecks();
      }
    });
    return () => subscription.remove();
  }, [runForegroundChecks]);

  const handleGoalBonusTriggered = useCallback(() => {
    suppressNextCatchUp.current = true;
    // Persist "seen" promptly (rather than waiting for the next foreground
    // check) so a killed app doesn't re-show G3 on the next cold start.
    void runForegroundChecks();
  }, [runForegroundChecks]);

  const handleCaptainTransferred = useCallback(() => {
    suppressNextCaptainBanner.current = true;
    void runForegroundChecks();
  }, [runForegroundChecks]);

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

        {activeTab === 'chat' ? (
          teamId && playerId ? (
            <ChatScreen
              teamId={teamId}
              viewerPlayerId={playerId}
              onOpened={() => setChatUnread(false)}
            />
          ) : (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.flame} size="large" />
            </View>
          )
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
          teamId && playerId ? (
            <TeamScreen
              teamId={teamId}
              viewerPlayerId={playerId}
              onManageGoal={handleNavigateToGoalTab}
              onCaptainTransferred={handleCaptainTransferred}
            />
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
      ) : captainBanner ? (
        <CaptainBanner variant={captainBanner.variant} onDismiss={() => setCaptainBanner(null)} />
      ) : null}

      <TabBar
        activeTab={activeTab}
        onSelect={setActiveTab}
        goalTabDot={catchUpBanner !== null}
        chatTabDot={chatUnread}
      />
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
