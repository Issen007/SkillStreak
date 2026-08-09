import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ChallengeClipModal } from './components/ChallengeClipModal';
import { ChallengeRow } from './components/ChallengeRow';
import { ConsentChips } from './components/ConsentChips';
import { TeammateRow } from './components/TeammateRow';
import { PendingJoinRow } from './components/PendingJoinRow';
import { InviteFriendSheet } from './components/InviteFriendSheet';
import { RosterScreen } from './RosterScreen';
import { CaptainTransferScreen } from './CaptainTransferScreen';
import { TeamPoolCard } from '../home/components/TeamPoolCard';
import { LeaderboardScreen } from '../leaderboard/LeaderboardScreen';
import { GoalCard } from '../goal/components/GoalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toast } from '../components/Toast';
import { LoadingOrRetry } from '../components/LoadingOrRetry';
import {
  ackClipChallenge,
  approveTeamJoin,
  getPendingClipChallenges,
  getPendingJoins,
  getTeamDashboard,
  getTeammates,
  rejectTeamJoin,
} from '../api/endpoints';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type {
  PendingChallengeEntry,
  PendingJoinEntry,
  TeamDashboardResponse,
  TeammateEntry,
} from '../api/types';

interface TeamScreenProps {
  teamId: string;
  /** Needed for Screen K4's "(Du)" row — the viewer's own id isn't part of
   * the teammates response itself. */
  viewerPlayerId: string;
  /** K1's "Hantera veckans mål" shortcut switches AppShell to the "Mål"
   * tab rather than duplicating that screen here. */
  onManageGoal: () => void;
  /** K1's new "Se vem som är klar →" link (per docs/design/
   * phase2.10-per-player-goal-flows.md) switches AppShell to the "Mål" tab
   * and lands directly on Screen G1D, not G1's card — same shortcut
   * pattern as `onManageGoal` above, just available to every viewer now,
   * not only captains. */
  onSeeGoalDetail: () => void;
  /** Fas 2.6a — tells AppShell this device just performed a captain
   * transfer, so its next foreground check doesn't also show Screen K5's
   * (optional) "handed off" banner for a change this device already knows
   * about directly. */
  onCaptainTransferred: () => void;
  /** Fas 4.6 — called on every challenges fetch and every successful ack,
   * so AppShell can set/clear the "Laget" tab dot immediately from data
   * this screen already has, without a second network round-trip. Same
   * "tell the parent directly, don't wait for the next foreground poll"
   * idiom as `onCaptainTransferred` above. */
  onChallengesChanged: (hasPending: boolean) => void;
}

type TeamViewState = 'summary' | 'roster' | 'captain-transfer' | 'leaderboard';

/** Screen K1 — the "Laget" tab. Every player sees the baseline aggregate
 * content (now including "Spelare i laget", Fas 2.6a); a captain
 * additionally sees a distinct card with three shortcut buttons, per
 * docs/design/phase2-flows.md Part 1 + docs/design/phase2.6-2.7-flows.md
 * Part A. Self-contained fetch on mount, same pattern as HomeScreen. */
export function TeamScreen({
  teamId,
  viewerPlayerId,
  onManageGoal,
  onSeeGoalDetail,
  onCaptainTransferred,
  onChallengesChanged,
}: TeamScreenProps) {
  const { t } = useTranslation('team');
  const [dashboard, setDashboard] = useState<TeamDashboardResponse | null>(null);
  const [teammates, setTeammates] = useState<TeammateEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<TeamViewState>('summary');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [pendingJoins, setPendingJoins] = useState<PendingJoinEntry[]>([]);
  const [decidingPlayerId, setDecidingPlayerId] = useState<string | null>(null);
  const [decidingAction, setDecidingAction] = useState<'approve' | 'reject' | null>(null);
  // Fas 4.6 (docs/design/clip-challenge-notifications-ui.md §1) — "someone
  // challenged *you*" clips this player hasn't acknowledged yet.
  const [pendingChallenges, setPendingChallenges] = useState<PendingChallengeEntry[]>([]);
  const [activeChallenge, setActiveChallenge] = useState<PendingChallengeEntry | null>(null);
  const [ackingClipId, setAckingClipId] = useState<string | null>(null);

  // "Fire both, render when both resolve" — one extra request, not a
  // second visible loading state, per the flow doc's Screen K1 note.
  const fetchAll = useCallback(async () => {
    try {
      const [dashboardResponse, teammatesResponse, challengesResponse] = await Promise.all([
        getTeamDashboard(teamId),
        getTeammates(teamId),
        // Fas 4.6 — every player, not captain-gated, so it belongs in the
        // Promise.all rather than in a conditional follow-up like
        // pendingJoins below. But it carries its own catch: a transient
        // failure, or the `403` a not-yet-consent/join-approved requester
        // gets from this endpoint's `assertConsentApproved`/
        // `assertTeamJoinApproved`, must not fail the whole screen's load
        // — the section just doesn't render (design doc §6).
        getPendingClipChallenges(teamId).catch(() => null),
      ]);
      setDashboard(dashboardResponse);
      setTeammates(teammatesResponse.teammates);
      setLoadError(null);

      const challenges = challengesResponse?.challenges ?? [];
      setPendingChallenges(challenges);
      onChallengesChanged(challenges.length > 0);

      // Fas 4 — a third, captain-only fetch, kept separate from the
      // Promise.all above rather than always firing it: a non-captain
      // calling GET .../pending-joins would just get a 403 for nothing,
      // since that endpoint is captain-gated server-side too.
      if (dashboardResponse.viewerIsCaptain) {
        try {
          const pendingResponse = await getPendingJoins(teamId);
          setPendingJoins(pendingResponse.pending);
        } catch {
          // Non-critical — the rest of the screen still works; the
          // captain just won't see pending joins this load.
        }
      } else {
        setPendingJoins([]);
      }
    } catch {
      setLoadError(t('k1.loadError'));
    } finally {
      setLoading(false);
    }
  }, [teamId, t, onChallengesChanged]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleApprove = async (player: PendingJoinEntry) => {
    setDecidingPlayerId(player.playerId);
    setDecidingAction('approve');
    try {
      await approveTeamJoin(teamId, player.playerId);
      setPendingJoins((prev) => prev.filter((p) => p.playerId !== player.playerId));
      setToastMessage(t('k1.approveSuccessToast', { screenName: player.screenName }));
    } catch {
      setToastMessage(t('k1.approveErrorToast'));
    } finally {
      setDecidingPlayerId(null);
      setDecidingAction(null);
    }
  };

  const handleReject = async (player: PendingJoinEntry) => {
    setDecidingPlayerId(player.playerId);
    setDecidingAction('reject');
    try {
      await rejectTeamJoin(teamId, player.playerId);
      setPendingJoins((prev) => prev.filter((p) => p.playerId !== player.playerId));
      setToastMessage(t('k1.rejectSuccessToast', { screenName: player.screenName }));
    } catch {
      setToastMessage(t('k1.rejectErrorToast'));
    } finally {
      setDecidingPlayerId(null);
      setDecidingAction(null);
    }
  };

  const dropChallenge = (clipId: string) => {
    setPendingChallenges((prev) => {
      const next = prev.filter((c) => c.clipId !== clipId);
      onChallengesChanged(next.length > 0);
      return next;
    });
  };

  /** Trigger A (design doc §2.1) — opens the modal *immediately*, never
   * gated on the ack call's round-trip, and fires the ack in parallel. The
   * ack's failure is deliberately silent (§2.4): the thing the player
   * actually wanted (watching) already succeeded, the call is idempotent,
   * and it retries for free the next time this row is tapped. */
  const handleWatchChallenge = (challenge: PendingChallengeEntry) => {
    setActiveChallenge(challenge);
    void ackClipChallenge(teamId, challenge.clipId)
      .then(() => dropChallenge(challenge.clipId))
      .catch(() => {
        // Silent by design — the row simply stays pending.
      });
  };

  /** Trigger B (§2.2) — "Redan sett", for a player who already watched the
   * clip elsewhere (the chat announcement embeds the same one) and
   * shouldn't be made to re-watch it just to clear a badge. Here the ack
   * call *is* the whole point of the tap, so unlike Trigger A its failure
   * gets a visible toast — same rule as approve/reject above. */
  const handleDismissChallenge = async (challenge: PendingChallengeEntry) => {
    setAckingClipId(challenge.clipId);
    try {
      await ackClipChallenge(teamId, challenge.clipId);
      dropChallenge(challenge.clipId);
      setToastMessage(
        t('k1.challengeAckedToast', { screenName: challenge.uploaderScreenName }),
      );
    } catch {
      setToastMessage(t('k1.challengeAckErrorToast'));
    } finally {
      setAckingClipId(null);
    }
  };

  if (view === 'roster') {
    return (
      <RosterScreen
        teamId={teamId}
        onBack={() => setView('summary')}
        onNotCaptain={() => {
          setView('summary');
          setToastMessage(t('k1.notCaptainToast'));
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
          setToastMessage(t('k1.notCaptainToast'));
        }}
        onTransferred={(newCaptainScreenName) => {
          onCaptainTransferred();
          setView('summary');
          setToastMessage(t('k1.captainTransferredToast', { newCaptainScreenName }));
          void fetchAll();
        }}
      />
    );
  }

  if (view === 'leaderboard') {
    return <LeaderboardScreen teamId={teamId} onBack={() => setView('summary')} />;
  }

  if (loading) {
    return <LoadingOrRetry loading />;
  }

  if (loadError || !dashboard || !teammates) {
    return (
      <LoadingOrRetry
        loading={false}
        errorMessage={loadError ?? t('k1.genericError')}
        retryLabel={t('k1.retry')}
        onRetry={() => void fetchAll()}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('k1.heading')}</Text>

        {/* Fas 4.6 — inserted first, ahead even of the captain-only
            pending-joins block below: pending joins are administrative,
            a pending challenge is personal ("someone challenged *you*"),
            the one thing on this tab a kid actually wants to see first
            (docs/design/clip-challenge-notifications-ui.md §1.1). No empty
            state — the section simply isn't rendered when there's nothing
            pending. */}
        {pendingChallenges.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>
              {t('k1.pendingChallengesHeading', { count: pendingChallenges.length })}
            </Text>
            <View style={styles.teammatesCard}>
              {pendingChallenges.map((challenge) => (
                <ChallengeRow
                  key={challenge.clipId}
                  uploaderScreenName={challenge.uploaderScreenName}
                  caption={challenge.caption}
                  playbackUrl={challenge.playbackUrl}
                  acking={ackingClipId === challenge.clipId}
                  onWatch={() => handleWatchChallenge(challenge)}
                  onDismiss={() => void handleDismissChallenge(challenge)}
                />
              ))}
            </View>
          </>
        ) : null}

        <ConsentChips
          approvedCount={dashboard.roster.approvedCount}
          pendingCount={dashboard.roster.pendingCount}
          revokedCount={dashboard.roster.revokedCount}
        />

        {/* Fas 4 — captain-only, only rendered when there's actually
            something to decide (docs/adr/0009-self-service-team-creation.md's
            2026-07-27 addendum). Placed before the roster so it reads as
            an action item, not buried below passive info. */}
        {dashboard.viewerIsCaptain && pendingJoins.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>{t('k1.pendingSectionLabel')}</Text>
            <View style={styles.teammatesCard}>
              {pendingJoins.map((player) => (
                <PendingJoinRow
                  key={player.playerId}
                  screenName={player.screenName}
                  avatarId={player.avatarId}
                  approving={decidingPlayerId === player.playerId && decidingAction === 'approve'}
                  rejecting={decidingPlayerId === player.playerId && decidingAction === 'reject'}
                  onApprove={() => void handleApprove(player)}
                  onReject={() => void handleReject(player)}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* Fas 2.10 — closes a pre-existing gap: this screen fetched
            `dashboard.weeklyGoal` but never rendered it. Reuses the exact
            same `GoalCard` as Screen G1 (no dashboard-specific variant),
            per docs/design/phase2.10-per-player-goal-flows.md. Omitted
            entirely when there's no active/draft goal — the proper empty
            state lives on the "Mål" tab already. */}
        {dashboard.weeklyGoal.current ? (
          <GoalCard
            title={dashboard.weeklyGoal.current.title}
            description={dashboard.weeklyGoal.current.description}
            targetMetric={dashboard.weeklyGoal.current.targetMetric}
            targetUnit={dashboard.weeklyGoal.current.targetUnit}
            targetValue={dashboard.weeklyGoal.current.targetValue}
            eligiblePlayerCount={dashboard.weeklyGoal.current.eligiblePlayerCount}
            completedPlayerCount={dashboard.weeklyGoal.current.completedPlayerCount}
            percentComplete={dashboard.weeklyGoal.current.percentComplete}
            goalMet={dashboard.weeklyGoal.current.goalMet}
            endDate={dashboard.weeklyGoal.current.endDate}
            onSeeDetail={onSeeGoalDetail}
          />
        ) : null}

        <Text style={styles.sectionLabel}>{t('k1.teammatesSectionLabel')}</Text>
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

        {/* Always visible, not just tucked inside the share sheet — a
            teammate should be able to just read the code out loud to a
            friend without opening anything. Any team member, not
            captain-gated (see the dashboard's own inviteCode comment). */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteCodeLabel}>{t('k1.inviteCodeLabel')}</Text>
          <Text style={styles.inviteCode}>{dashboard.inviteCode}</Text>
          <PrimaryButton label={t('k1.inviteButton')} onPress={() => setInviteSheetOpen(true)} />
        </View>

        <TeamPoolCard
          pointsTotal={dashboard.teamPool.pointsTotal}
          rank={dashboard.teamPool.rank}
          teamCount={dashboard.teamPool.teamCount}
          effortRank={dashboard.teamPool.effortRank}
          onPress={() => setView('leaderboard')}
        />

        {dashboard.viewerIsCaptain ? (
          <View style={styles.captainCard}>
            <Text style={styles.captainBadge}>{t('k1.captainBadge')}</Text>
            <PrimaryButton label={t('k1.captainSeeDetail')} onPress={() => setView('roster')} />
            <PrimaryButton label={t('k1.captainManageGoal')} onPress={onManageGoal} />
            <PrimaryButton label={t('k1.captainSwapCaptain')} onPress={() => setView('captain-transfer')} />
          </View>
        ) : null}
      </ScrollView>

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}

      <ChallengeClipModal
        challenge={activeChallenge}
        onClose={() => setActiveChallenge(null)}
      />

      <InviteFriendSheet
        visible={inviteSheetOpen}
        inviteCode={dashboard.inviteCode}
        teamName={dashboard.teamName}
        onClose={() => setInviteSheetOpen(false)}
        onCopied={() => {
          setInviteSheetOpen(false);
          setToastMessage(t('k1.linkCopiedToast'));
        }}
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
  inviteCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    gap: 10,
  },
  inviteCodeLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  inviteCode: {
    fontFamily: fonts.headingBold,
    fontSize: 26,
    color: colors.ink,
    letterSpacing: 1.5,
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
});
