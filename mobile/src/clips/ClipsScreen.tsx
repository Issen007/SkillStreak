import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { ClipIntroCard } from './components/ClipIntroCard';
import { ClipsWaitingCard } from './components/ClipsWaitingCard';
import { ClipGrid } from './components/ClipGrid';
import { ClipPlayerModal } from './components/ClipPlayerModal';
import { ClipReportSheet } from './components/ClipReportSheet';
import { ClipReportConfirmationSheet } from './components/ClipReportConfirmationSheet';
import { ClipDeleteSheet } from './components/ClipDeleteSheet';
import { UploadFlow } from './upload/UploadFlow';
import { BlockSheet } from '../chat/components/BlockSheet';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toast } from '../components/Toast';
import { LoadingOrRetry } from '../components/LoadingOrRetry';
import { blockChatPlayer, deleteClip, getClips, getMe, reportClip } from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import {
  addCachedChatBlock,
  addSeenChallengeClipId,
  getClipLastViewedAt,
  getHasSeenClipIntro,
  getSeenChallengeClipIds,
  setClipLastViewedAt,
  setHasSeenClipIntro,
} from '../api/localFlags';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type {
  ClipFeedItem,
  ClipReportReason,
  ConsentStatus,
  TeamJoinStatus,
} from '../api/types';

interface ClipsScreenProps {
  teamId: string;
  viewerPlayerId: string;
  /** Called once on mount — lets AppShell clear the "Klipp" tab's unread
   * dot the moment this tab is actually opened, per the flow doc's
   * "Unread indicator" note (same convention as `ChatScreen.onOpened`). */
  onOpened: () => void;
}

const FEED_PAGE_SIZE = 20;

interface BlockTarget {
  playerId: string;
  screenName: string;
  avatarId: string;
}

interface ReportConfirmationState {
  reason: ClipReportReason;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
}

/** Screens V0-V2 — the "Klipp" tab. Consent gates both reads *and* writes
 * (the divergence from Chatt the contract calls out explicitly), so this
 * screen's whole-tab state depends on `consentStatus`, not just a disabled
 * upload button. `GET .../clips` is fetched on open/foreground/pull-to-
 * refresh only — deliberately not polled continuously like Chatt, and
 * paginated via an explicit "Visa fler Shorts" button, never auto-loaded on
 * scroll (see the flow doc's playback-mechanics and pagination judgment
 * calls). */
export function ClipsScreen({ teamId, viewerPlayerId, onOpened }: ClipsScreenProps) {
  const { t } = useTranslation('clips');
  const [hasSeenIntro, setHasSeenIntroState] = useState<boolean | null>(null);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus | null>(null);
  const [isSelfVerification, setIsSelfVerification] = useState(false);
  const [teamJoinStatus, setTeamJoinStatus] = useState<TeamJoinStatus | null>(null);

  const [clips, setClips] = useState<ClipFeedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const [revealedClipId, setRevealedClipId] = useState<string | null>(null);
  // Screen V2 (revised)'s grid+modal split (docs/design/clip-library-grid.md
  // §2) — `null` = closed, same convention `reportTarget`/`deleteTarget`/
  // `blockTarget` below already use. Set on grid-cell tap, cleared on the
  // modal's close *and* on a successful report/delete/block of this same
  // clip, so the modal never lingers open on a clip that's already gone
  // from the grid behind it.
  const [activeClip, setActiveClip] = useState<ClipFeedItem | null>(null);
  const [reportTarget, setReportTarget] = useState<ClipFeedItem | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportConfirmation, setReportConfirmation] = useState<ReportConfirmationState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClipFeedItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [challengeBanner, setChallengeBanner] = useState<string | null>(null);
  const [view, setView] = useState<'feed' | 'upload'>('feed');

  const hasOpenedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    void getHasSeenClipIntro().then(setHasSeenIntroState);
  }, []);

  // Player's own consent status — an independent fetch (not shared state
  // from AppShell), same posture as ChatScreen's own `fetchConsentStatus`:
  // a stale value here just means this screen's locked state is one
  // foreground-check behind, and `GET .../clips`'s own `403` is the real,
  // authoritative gate below.
  const fetchConsentStatus = useCallback(async () => {
    try {
      const me = await getMe();
      setConsentStatus(me.player.consentStatus);
      setIsSelfVerification(me.player.isSelfVerification);
      setTeamJoinStatus(me.player.teamJoinStatus);
    } catch {
      // Non-critical — see above.
    }
  }, []);

  useEffect(() => {
    void fetchConsentStatus();
  }, [fetchConsentStatus]);

  const checkForChallengeBanner = useCallback(
    async (feedClips: ClipFeedItem[]) => {
      const seen = await getSeenChallengeClipIds(teamId);
      const newlyChallenged = feedClips.find(
        (clip) => clip.taggedPlayerId === viewerPlayerId && !seen.includes(clip.clipId),
      );
      if (!newlyChallenged) return;
      // Persisted immediately on first *display*, not dismissal — same
      // "a killed app doesn't re-show it" rule K5/G3 already established.
      await addSeenChallengeClipId(teamId, newlyChallenged.clipId);
      setChallengeBanner(t('v2.challengeBanner', { screenName: newlyChallenged.uploaderScreenName }));
    },
    [teamId, viewerPlayerId, t],
  );

  const fetchInitial = useCallback(async () => {
    try {
      const response = await getClips(teamId, { limit: FEED_PAGE_SIZE });
      setClips(response.clips);
      setHasMore(response.clips.length === FEED_PAGE_SIZE);
      setLoadError(null);
      void checkForChallengeBanner(response.clips);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'consent_required') {
        setConsentStatus((prev) => prev ?? 'pending');
        setLoadError(null);
        return;
      }
      setLoadError(t('v2.loadError'));
    } finally {
      setManualRefreshing(false);
      hasLoadedOnceRef.current = true;
    }
  }, [teamId, checkForChallengeBanner, t]);

  useEffect(() => {
    if (hasSeenIntro === true) void fetchInitial();
  }, [hasSeenIntro, fetchInitial]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hasLoadedOnceRef.current) {
        void fetchConsentStatus();
        void fetchInitial();
      }
    });
    return () => subscription.remove();
  }, [fetchConsentStatus, fetchInitial]);

  // Cleared the moment the tab is opened, per the flow doc — not on
  // scrolling to the bottom (identical convention to ChatScreen).
  useEffect(() => {
    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;
    void setClipLastViewedAt(teamId, new Date().toISOString());
    onOpened();
  }, [teamId, onOpened]);

  const handleManualRefresh = () => {
    setManualRefreshing(true);
    void fetchConsentStatus();
    void fetchInitial();
  };

  const handleShowMore = async () => {
    if (!clips || clips.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = clips[clips.length - 1];
      const response = await getClips(teamId, { before: oldest.createdAt, limit: FEED_PAGE_SIZE });
      setClips((prev) => [...(prev ?? []), ...response.clips]);
      setHasMore(response.clips.length === FEED_PAGE_SIZE);
    } catch {
      setToastMessage(t('v2.showMoreError'));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDismissIntro = () => {
    void setHasSeenClipIntro();
    setHasSeenIntroState(true);
  };

  const handleTapFab = () => {
    if (consentStatus !== 'approved') {
      setToastMessage(t('v2.uploadLockedToast'));
      return;
    }
    setView('upload');
  };

  const handleTapMeta = (clipId: string) => {
    setRevealedClipId((prev) => (prev === clipId ? null : clipId));
  };

  const handleTapReport = (clip: ClipFeedItem) => {
    setRevealedClipId(null);
    setReportTarget(clip);
  };

  const handleTapDelete = (clip: ClipFeedItem) => {
    setRevealedClipId(null);
    setDeleteTarget(clip);
  };

  const handleTapAvatar = (clip: ClipFeedItem) => {
    setBlockTarget({
      playerId: clip.uploaderPlayerId,
      screenName: clip.uploaderScreenName,
      avatarId: clip.uploaderAvatarId,
    });
  };

  const handleReportSubmit = async (reason: ClipReportReason, note: string | undefined) => {
    if (!reportTarget) return;
    setReportSubmitting(true);
    try {
      await reportClip(teamId, reportTarget.clipId, { reason, note });
      // Immediate auto-hide (ADR-0010 Decision 4) — remove locally right
      // away rather than waiting on the next fetch, since the clip is
      // genuinely gone from every teammate's feed the instant this
      // succeeds, including the reporter's own.
      setClips((prev) => prev?.filter((c) => c.clipId !== reportTarget.clipId) ?? prev);
      setReportConfirmation({
        reason,
        uploaderPlayerId: reportTarget.uploaderPlayerId,
        uploaderScreenName: reportTarget.uploaderScreenName,
        uploaderAvatarId: reportTarget.uploaderAvatarId,
      });
      setReportTarget(null);
      // Modal (if this report was filed from it, per the grid+modal
      // rework) closes on a successful report — the clip it was showing no
      // longer exists in the grid behind it either.
      setActiveClip((prev) => (prev?.clipId === reportTarget.clipId ? null : prev));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'clip_not_found') {
        setToastMessage(t('v2.reportNotFoundToast'));
        setReportTarget(null);
        // The clip is already gone — same as the success path above, don't
        // leave the modal open on it.
        setActiveClip((prev) => (prev?.clipId === reportTarget.clipId ? null : prev));
        void fetchInitial();
      } else if (err instanceof ApiError && err.code === 'clip_already_reported_by_you') {
        setToastMessage(t('v2.reportAlreadyToast'));
        setReportTarget(null);
      } else if (err instanceof ApiError && err.code === 'clip_report_rate_limited') {
        setToastMessage(t('v2.reportRateLimitedToast'));
        setReportTarget(null);
      } else {
        setToastMessage(t('v2.genericError'));
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      await deleteClip(teamId, deleteTarget.clipId);
      setClips((prev) => prev?.filter((c) => c.clipId !== deleteTarget.clipId) ?? prev);
      setToastMessage(t('v2.deletedToast'));
      setDeleteTarget(null);
      // Same as the report path above — the modal closes on a successful
      // delete of the clip it was showing.
      setActiveClip((prev) => (prev?.clipId === deleteTarget.clipId ? null : prev));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'clip_not_found') {
        setToastMessage(t('v2.deleteNotFoundToast'));
        setDeleteTarget(null);
        // The clip is already gone — same as the success path above, don't
        // leave the modal open on it.
        setActiveClip((prev) => (prev?.clipId === deleteTarget.clipId ? null : prev));
        void fetchInitial();
      } else {
        setToastMessage(t('v2.genericError'));
      }
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const performBlock = async (target: BlockTarget) => {
    setBlockSubmitting(true);
    try {
      await blockChatPlayer(teamId, { blockedPlayerId: target.playerId });
      await addCachedChatBlock(teamId, {
        blockedPlayerId: target.playerId,
        screenName: target.screenName,
        avatarId: target.avatarId,
      });
      // A block covers both chat and clips (per the flow doc's
      // TeamChatBlock decision) — filter this uploader's clips out of the
      // local list immediately, not just on the next fetch.
      setClips((prev) => prev?.filter((c) => c.uploaderPlayerId !== target.playerId) ?? prev);
      // If the modal happened to be open on a clip from the just-blocked
      // uploader (reached via its own "tap avatar" -> CH4 path), it's
      // gone from the grid behind it now too — same guard as the
      // report/delete paths above.
      setActiveClip((prev) => (prev?.uploaderPlayerId === target.playerId ? null : prev));
      setToastMessage(t('v2.blockedToast', { screenName: target.screenName }));
    } catch {
      setToastMessage(t('v2.genericError'));
    } finally {
      setBlockSubmitting(false);
    }
  };

  const handleReportConfirmationBlock = async () => {
    if (!reportConfirmation) return;
    await performBlock({
      playerId: reportConfirmation.uploaderPlayerId,
      screenName: reportConfirmation.uploaderScreenName,
      avatarId: reportConfirmation.uploaderAvatarId,
    });
    setReportConfirmation(null);
  };

  if (view === 'upload') {
    return (
      <UploadFlow
        teamId={teamId}
        viewerPlayerId={viewerPlayerId}
        onCancel={() => setView('feed')}
        onConsentRevoked={() => {
          setView('feed');
          setToastMessage(t('v2.consentRevokedToast'));
          void fetchConsentStatus();
          void fetchInitial();
        }}
        onPublished={() => {
          setView('feed');
          void fetchInitial();
        }}
      />
    );
  }

  if (hasSeenIntro === null) {
    return (
      <LoadingOrRetry
        loading
        style={{ gap: 8, paddingHorizontal: 0, paddingTop: 60 }}
      />
    );
  }

  if (hasSeenIntro === false) {
    return <ClipIntroCard onDismiss={handleDismissIntro} />;
  }

  const locked =
    (consentStatus !== null && consentStatus !== 'approved') ||
    (teamJoinStatus !== null && teamJoinStatus !== 'approved');

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={manualRefreshing}
            onRefresh={handleManualRefresh}
            tintColor={colors.flame}
          />
        }
      >
        <Text style={styles.heading}>{t('v2.heading')}</Text>

        {locked ? (
          <ClipsWaitingCard
            consentStatus={consentStatus ?? 'pending'}
            isSelfVerification={isSelfVerification}
            teamJoinStatus={teamJoinStatus ?? 'pending'}
            onRefresh={handleManualRefresh}
            refreshing={manualRefreshing}
          />
        ) : clips === null ? (
          <LoadingOrRetry loading fullScreen={false} style={{ gap: 8, paddingTop: 60 }} />
        ) : loadError ? (
          <LoadingOrRetry
            loading={false}
            fullScreen={false}
            style={{ gap: 8, paddingTop: 60 }}
            errorMessage={loadError}
            retryLabel={t('v2.retry')}
            onRetry={() => void fetchInitial()}
          />
        ) : clips.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyHeading}>{t('v2.emptyHeading')}</Text>
            <Text style={styles.emptySub}>{t('v2.emptySub')}</Text>
            <PrimaryButton label={t('v2.uploadButton')} onPress={handleTapFab} />
          </View>
        ) : (
          <ClipGrid
            clips={clips}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onPressClip={setActiveClip}
            onShowMore={() => void handleShowMore()}
          />
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={handleTapFab}
        style={[styles.fab, locked && styles.fabLocked]}
      >
        <Text style={styles.fabIcon}>{locked ? '🔒' : '+'}</Text>
      </Pressable>

      <ClipPlayerModal
        clip={activeClip}
        isOwn={activeClip?.uploaderPlayerId === viewerPlayerId}
        revealed={activeClip !== null && revealedClipId === activeClip.clipId}
        onTapAvatar={
          activeClip && activeClip.uploaderPlayerId !== viewerPlayerId
            ? () => handleTapAvatar(activeClip)
            : undefined
        }
        onTapMeta={() => {
          if (activeClip) handleTapMeta(activeClip.clipId);
        }}
        onTapReport={() => {
          if (activeClip) handleTapReport(activeClip);
        }}
        onTapDelete={() => {
          if (activeClip) handleTapDelete(activeClip);
        }}
        onClose={() => setActiveClip(null)}
      />

      <ClipReportSheet
        visible={reportTarget !== null}
        loading={reportSubmitting}
        onSubmit={(reason, note) => void handleReportSubmit(reason, note)}
        onClose={() => setReportTarget(null)}
      />

      <ClipReportConfirmationSheet
        visible={reportConfirmation !== null}
        reason={reportConfirmation?.reason ?? 'other'}
        reportedScreenName={reportConfirmation?.uploaderScreenName ?? ''}
        onBlock={() => void handleReportConfirmationBlock()}
        onDone={() => setReportConfirmation(null)}
      />

      <ClipDeleteSheet
        visible={deleteTarget !== null}
        loading={deleteSubmitting}
        onConfirm={() => void handleDeleteConfirm()}
        onClose={() => setDeleteTarget(null)}
      />

      <BlockSheet
        visible={blockTarget !== null}
        screenName={blockTarget?.screenName ?? ''}
        loading={blockSubmitting}
        onConfirm={() => {
          if (blockTarget) void performBlock(blockTarget);
          setBlockTarget(null);
        }}
        onClose={() => setBlockTarget(null)}
      />

      {challengeBanner ? (
        // Screen V3 — reuses the existing `Toast` component verbatim (per
        // mobile/README.md's own "known duplication" note, this is exactly
        // the kind of near-duplicate overlay this project already flagged
        // as worth consolidating rather than reinventing a fifth one for
        // Fas 3) rather than a new bespoke banner component.
        <Toast message={challengeBanner} durationMs={3000} onDismiss={() => setChallengeBanner(null)} />
      ) : toastMessage ? (
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      ) : null}
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
    paddingBottom: 90,
    gap: 14,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  emptyHeading: {
    fontFamily: fonts.headingBold,
    fontSize: 17,
    color: colors.ink,
  },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 6,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.flame,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.flame,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  fabLocked: {
    backgroundColor: colors.disabledBg,
    shadowOpacity: 0,
  },
  fabIcon: {
    fontSize: 24,
    color: colors.white,
  },
});
