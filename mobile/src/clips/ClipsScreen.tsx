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
import { PublicFeedScreen } from './PublicFeedScreen';
import { ClipGrid } from './components/ClipGrid';
import { ClipPlayerModal } from './components/ClipPlayerModal';
import { ClipReportSheet } from './components/ClipReportSheet';
import { ClipReportConfirmationSheet } from './components/ClipReportConfirmationSheet';
import { ClipDeleteSheet } from './components/ClipDeleteSheet';
import { ClipShareSheet } from './components/ClipShareSheet';
import { UploadFlow } from './upload/UploadFlow';
import { BlockSheet } from '../chat/components/BlockSheet';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toast } from '../components/Toast';
import { LoadingOrRetry } from '../components/LoadingOrRetry';
import {
  blockChatPlayer,
  deleteClip,
  getClips,
  getMe,
  getPublicSharingStatus,
  publishClipPublicly,
  reportClip,
  requestPublicSharing,
  unpublishClipPublicly,
  getSavedClips,
} from '../api/endpoints';
import type { PublicSharingStatus } from '../api/types';
import { ApiError } from '../api/ApiError';
import {
  addCachedChatBlock,
  getClipLastViewedAt,
  getHasSeenClipIntro,
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
  // ADR-0030. `sharingStatus` is null until the first fetch answers; the
  // share row stays hidden until then rather than flashing an affordance
  // that may not apply to this team.
  const [sharingStatus, setSharingStatus] = useState<PublicSharingStatus | null>(null);
  const [shareTarget, setShareTarget] = useState<ClipFeedItem | null>(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /**
   * Which of the two Shorts surfaces is showing.
   *
   * **Defaults to the archive, never to Utforska.** Opening straight into
   * an endless scroll of strangers is the pattern the reference apps use
   * and the one this app should not copy — a child arrives in their own
   * and their team's material and chooses to go outward.
   */
  const [surface, setSurface] = useState<'archive' | 'explore'>('archive');
  /**
   * Which collection inside Arkiv. `team` is the whole team feed; `mine`
   * is the same feed filtered to this player's own uploads, which is the
   * only place a clip can be published from — offering that control on a
   * teammate's cell would teach the wrong model of who may publish what.
   */
  const [collection, setCollection] = useState<'team' | 'mine' | 'saved'>('team');
  const [savedItems, setSavedItems] = useState<ClipFeedItem[] | null>(null);
  /** How many saved clips are no longer public. A number, never a list —
   * naming them would let a viewer track another child's un-publish
   * decisions. */
  const [savedMissingCount, setSavedMissingCount] = useState(0);
  const [savedError, setSavedError] = useState(false);
  /** Opened from Sparade. Kept apart from `activeClip` so the player is
   * mounted read-only: a stranger's clip must not offer delete, share, or
   * the team report path, which would post to a team the viewer is not in. */
  const [activeSavedClip, setActiveSavedClip] = useState<ClipFeedItem | null>(null);
  const [view, setView] = useState<'feed' | 'upload'>('feed');

  const hasOpenedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  /**
   * ADR-0030. Re-read on focus and on app resume alongside the existing
   * consent fetch, because the thing that changes it happens outside the
   * app entirely: a parent clicking Approve — or Revoke — in their inbox.
   * A cached `canShare` is exactly what must not decide whether a child's
   * video can leave the team.
   */
  const fetchSharingStatus = useCallback(async () => {
    try {
      setSharingStatus(await getPublicSharingStatus());
    } catch {
      // Deliberately silent, and it fails closed: the share row is hidden
      // while status is null, so a failed fetch removes the affordance
      // rather than leaving a stale one that might now be wrong.
      setSharingStatus(null);
    }
  }, []);

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

  // Screen V3's one-time "you were challenged" toast used to be triggered
  // from here — removed in Fas 4.6, superseded (not duplicated) by the
  // Laget tab's persistent, server-backed pending-challenges section per
  // docs/adr/0021-clip-challenge-notifications.md Decision 1.
  const fetchInitial = useCallback(async () => {
    try {
      const response = await getClips(teamId, { limit: FEED_PAGE_SIZE });
      setClips(response.clips);
      setHasMore(response.clips.length === FEED_PAGE_SIZE);
      setLoadError(null);
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
  }, [teamId, t]);

  useEffect(() => {
    if (hasSeenIntro === true) {
      void fetchInitial();
      void fetchSharingStatus();
    }
  }, [hasSeenIntro, fetchInitial, fetchSharingStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hasLoadedOnceRef.current) {
        void fetchConsentStatus();
        void fetchSharingStatus();
        void fetchInitial();
      }
    });
    return () => subscription.remove();
  }, [fetchConsentStatus, fetchSharingStatus, fetchInitial]);

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

  const handleTapShare = (clip: ClipFeedItem) => {
    setShareError(null);
    setShareTarget(clip);
    // Refreshed on open as well: the sheet is where the decision is made,
    // and a parent may have revoked since the tab was last focused.
    void fetchSharingStatus();
  };

  const handleAskParent = async () => {
    setShareSubmitting(true);
    setShareError(null);
    try {
      await requestPublicSharing();
      await fetchSharingStatus();
    } catch {
      setShareError(t('clipShareSheet.errorGeneric'));
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleSharePublish = async () => {
    if (!shareTarget) return;
    setShareSubmitting(true);
    setShareError(null);
    try {
      await publishClipPublicly(shareTarget.clipId);
      // Refetched rather than patched locally: the server is the only
      // thing that knows whether the publish actually took, and this is
      // the state that decides who can see a child.
      await Promise.all([fetchInitial(), fetchSharingStatus()]);
      setShareTarget(null);
    } catch {
      // The most likely cause is a consent revoked since the sheet opened,
      // so the status is re-read before the message is shown — that way
      // reopening the sheet shows the true state rather than the old one.
      await fetchSharingStatus();
      setShareError(t('clipShareSheet.errorRevoked'));
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleShareUnpublish = async () => {
    if (!shareTarget) return;
    setShareSubmitting(true);
    setShareError(null);
    try {
      await unpublishClipPublicly(shareTarget.clipId);
      await fetchInitial();
      setShareTarget(null);
    } catch {
      setShareError(t('clipShareSheet.errorGeneric'));
    } finally {
      setShareSubmitting(false);
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

  // **Declared here, above every early return, and that placement is the
  // whole point.** These two were originally written next to the Sparade
  // render branch, which sits after `if (hasSeenIntro === null) return`.
  // On the first render that early return fires and these hooks never
  // run; once `hasSeenIntro` resolves the render continues past it and
  // React sees two hooks that did not exist before — "rendered more hooks
  // than during the previous render", which crashes the screen outright.
  // Shipped that way on 2026-08-21 and crashed the Shorts tab for the
  // project owner. Any hook added to this component belongs above line
  // one of the early returns, no matter where its markup lives.
  const loadSaved = useCallback(async () => {
    setSavedError(false);
    try {
      const response = await getSavedClips();
      // Adapted to the grid's existing shape rather than duplicating the
      // cell. `uploaderPlayerId` is deliberately empty: it is only ever
      // compared against the viewer's own id to decide ownership, and a
      // saved clip is by definition someone else's.
      setSavedItems(
        response.items.map((item) => ({
          clipId: item.clipId,
          uploaderPlayerId: '',
          uploaderScreenName: item.screenName,
          uploaderAvatarId: item.avatarId ?? '',
          taggedPlayerId: null,
          taggedScreenName: null,
          caption: item.caption,
          playbackUrl: item.playbackUrl,
          createdAt: item.publishedAt,
          reportedByMe: false,
          publishedPublicly: true,
        })),
      );
      setSavedMissingCount(response.missingCount);
    } catch {
      setSavedError(true);
    }
  }, []);

  useEffect(() => {
    if (collection === 'saved' && savedItems === null && !savedError) {
      void loadSaved();
    }
  }, [collection, savedItems, savedError, loadSaved]);

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

  const visibleClips =
    clips === null
      ? null
      : collection === 'mine'
        ? clips.filter((c) => c.uploaderPlayerId === viewerPlayerId)
        : clips;

  // The tab pair only exists once the feature is live for this team. A
  // team outside the rollout allow-list sees no Utforska tab at all —
  // the same reasoning as the absent share row: nothing is advertised to
  // a child who cannot use it.
  const exploreAvailable = !locked && sharingStatus?.available === true;

  const tabs = exploreAvailable ? (
    <View style={styles.tabRow} accessibilityRole="tablist">
      {(['archive', 'explore'] as const).map((value) => {
        const selected = surface === value;
        return (
          <Pressable
            key={value}
            style={[styles.tab, selected ? styles.tabOn : null]}
            onPress={() => setSurface(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.tabLabel, selected ? styles.tabLabelOn : null]}>
              {t(value === 'archive' ? 'publicFeed.tabArchive' : 'publicFeed.tabExplore')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  // Utforska is a full-bleed pager, so it replaces the scrolling body
  // rather than sitting inside it. No upload FAB here either: you publish
  // from your own archive, and offering it over a stranger's clip would
  // teach the wrong model.
  if (exploreAvailable && surface === 'explore') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>{t('v2.heading')}</Text>
        {tabs}
        <PublicFeedScreen onToast={setToastMessage} />
        {toastMessage ? (
          <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        ) : null}
      </View>
    );
  }

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
        {tabs}

        {!locked && clips !== null && !loadError ? (
          <View style={styles.tabRow} accessibilityRole="tablist">
            {(['team', 'mine', 'saved'] as const).map((value) => {
              const selected = collection === value;
              return (
                <Pressable
                  key={value}
                  style={[styles.subTab, selected ? styles.subTabOn : null]}
                  onPress={() => setCollection(value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[styles.subTabLabel, selected ? styles.subTabLabelOn : null]}
                  >
                    {t(
                      value === 'team'
                        ? 'publicFeed.collectionTeam'
                        : value === 'mine'
                          ? 'publicFeed.collectionMine'
                          : 'publicFeed.collectionSaved',
                    )}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!locked && collection === 'saved' ? (
          savedError ? (
            <LoadingOrRetry
              loading={false}
              fullScreen={false}
              style={{ gap: 8, paddingTop: 60 }}
              errorMessage={t('publicFeed.loadError')}
              retryLabel={t('v2.retry')}
              onRetry={() => void loadSaved()}
            />
          ) : savedItems === null ? (
            <LoadingOrRetry loading fullScreen={false} style={{ gap: 8, paddingTop: 60 }} />
          ) : savedItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyHeading}>{t('publicFeed.savedEmptyHeading')}</Text>
              <Text style={styles.emptySub}>{t('publicFeed.savedEmptyBody')}</Text>
            </View>
          ) : (
            <>
              <ClipGrid
                clips={savedItems}
                hasMore={false}
                loadingMore={false}
                onPressClip={setActiveSavedClip}
                onShowMore={() => undefined}
              />
              {savedMissingCount > 0 ? (
                <Text style={styles.savedMissingRow}>{t('publicFeed.savedMissing')}</Text>
              ) : null}
            </>
          )
        ) : locked ? (
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
        ) : visibleClips !== null && visibleClips.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyHeading}>
              {t(
                collection === 'mine'
                  ? 'publicFeed.mineEmptyHeading'
                  : 'v2.emptyHeading',
              )}
            </Text>
            <Text style={styles.emptySub}>
              {t(
                collection === 'mine'
                  ? 'publicFeed.mineEmptyBody'
                  : 'v2.emptySub',
              )}
            </Text>
            <PrimaryButton label={t('v2.uploadButton')} onPress={handleTapFab} />
          </View>
        ) : (
          <ClipGrid
            clips={visibleClips ?? []}
            hasMore={collection === 'team' && hasMore}
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

      {/* Sparade's player, deliberately a second mount rather than a
          branch on the one below. A saved clip belongs to a stranger, so
          every action callback is omitted: no delete, no share, and
          crucially no report — the team report path posts to a team this
          viewer is not in. Reporting a public clip happens in Utforska,
          where the endpoint that matches it lives. */}
      <ClipPlayerModal
        clip={activeSavedClip}
        isOwn={false}
        revealed={false}
        onTapMeta={() => undefined}
        onClose={() => setActiveSavedClip(null)}
      />

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
        onTapShare={
          sharingStatus?.available && activeClip
            ? () => handleTapShare(activeClip)
            : undefined
        }
        sharingConsent={sharingStatus?.consent ?? null}
        // Same destination as the share row, deliberately: the share sheet
        // is where the child reads what a stranger would see before any
        // mail goes to their parent. Offered only for `none` — a pending
        // request is moved by the parent's inbox, not by asking twice.
        onTapAskParent={
          sharingStatus?.available &&
          sharingStatus.consent === 'none' &&
          activeClip
            ? () => handleTapShare(activeClip)
            : undefined
        }
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

      <ClipShareSheet
        visible={shareTarget !== null}
        loading={shareSubmitting}
        status={sharingStatus}
        isShared={shareTarget?.publishedPublicly ?? false}
        error={shareError}
        onAskParent={() => void handleAskParent()}
        onPublish={() => void handleSharePublish()}
        onUnpublish={() => void handleShareUnpublish()}
        onClose={() => setShareTarget(null)}
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
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 90,
    gap: 14,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tabOn: {
    borderColor: colors.flame,
    backgroundColor: colors.flameTint,
  },
  tabLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textBody,
  },
  tabLabelOn: {
    fontFamily: fonts.headingBold,
    color: colors.flame,
  },
  subTab: {
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subTabOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  subTabLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.textBody },
  subTabLabelOn: { fontFamily: fonts.bodyBold, color: colors.white },
  savedMissingRow: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: 20,
    paddingTop: 14,
    lineHeight: 17,
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
