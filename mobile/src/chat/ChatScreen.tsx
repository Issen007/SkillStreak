import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { ChatIntroCard } from './components/ChatIntroCard';
import { MessageBubble } from './components/MessageBubble';
import { ComposeBar, type ComposerAttachedClip } from './components/ComposeBar';
import { ClipAttachSheet } from './components/ClipAttachSheet';
import { ReportSheet } from './components/ReportSheet';
import { ReportConfirmationSheet } from './components/ReportConfirmationSheet';
import { BlockSheet } from './components/BlockSheet';
import { BlockedListScreen } from './BlockedListScreen';
// ADR-0017 Part E — reused verbatim from the Klipp tab (Screens V9/V10),
// per the flow doc's "Report affordance" section: reporting the clip
// itself is exactly the existing clip-report flow, called with the
// `clipId` already on hand from the message's `clip` block.
import { ClipReportSheet } from '../clips/components/ClipReportSheet';
import { ClipReportConfirmationSheet } from '../clips/components/ClipReportConfirmationSheet';
import { Toast } from '../components/Toast';
import {
  blockChatPlayer,
  getChatMessages,
  getMe,
  postChatMessage,
  reportChatMessage,
  reportClip,
} from '../api/endpoints';
import { ApiError } from '../api/ApiError';
import {
  addCachedChatBlock,
  getHasSeenChatIntro,
  setChatLastViewedAt,
  setHasSeenChatIntro,
} from '../api/localFlags';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import type {
  ChatMessage,
  ChatReportReason,
  ClipFeedItem,
  ClipReportReason,
  ConsentStatus,
  PostChatMessageRequest,
  TeamJoinStatus,
} from '../api/types';

interface ChatScreenProps {
  teamId: string;
  viewerPlayerId: string;
  /** Called once on mount — lets AppShell clear the "Chatt" tab's unread
   * dot the moment this tab is actually opened (not on scrolling to the
   * bottom), per the flow doc's "Unread indicator" note. */
  onOpened: () => void;
  /** ADR-0017 Part E, Screen CH6's empty-state "Gå till Klipp" — closes
   * the picker and switches AppShell's active tab to "Klipp", reusing the
   * app's existing tab-switch mechanism (mirrors `HomeScreen`'s
   * `onNavigateToGoalTab` shape). */
  onGoToClipsTab: () => void;
}

const POLL_INTERVAL_MS = 5000;
const REPORT_EXCERPT_LENGTH = 60;

interface BlockTarget {
  playerId: string;
  screenName: string;
  avatarId: string;
}

interface ReportConfirmationState {
  reason: ChatReportReason;
  senderPlayerId: string;
  senderScreenName: string;
  senderAvatarId: string;
}

/** ADR-0017 Part E — the clip-report reveal's own target, kept separate
 * from `ReportConfirmationState`/`reportTarget` above since it's a
 * different, parallel flow (reports the *clip*, via V9/V10 unmodified,
 * not the message, via CH2/CH3). */
interface ClipReportTarget {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
}

interface ClipReportConfirmationState {
  reason: ClipReportReason;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
}

/** Screens CH0/CH1 — the "Chatt" tab. `GET .../chat/messages` on open,
 * then polled every ~5s while this screen is focused, paused entirely
 * when backgrounded (ADR-0007 Decision 5's "boring, no WebSocket" choice)
 * — since AppShell fully unmounts an inactive tab (no keep-alive), "focused"
 * here is simply "mounted," so a tab switch away already stops the poll;
 * an `AppState` listener additionally pauses/resumes it across
 * backgrounding. No backward pagination exists in the contract — this is a
 * rolling window of the most recent messages, not a searchable archive
 * (deliberate, per the flow doc's judgment call 11). */
export function ChatScreen({ teamId, viewerPlayerId, onOpened, onGoToClipsTab }: ChatScreenProps) {
  const { t } = useTranslation('chat');
  const [hasSeenIntro, setHasSeenIntroState] = useState<boolean | null>(null);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus | null>(null);
  // Added 2026-07-27 — a second, independent gate (captain approval of
  // the team join itself) alongside consentStatus above.
  const [teamJoinStatus, setTeamJoinStatus] = useState<TeamJoinStatus | null>(null);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // ADR-0017 Part E — Screen CH6's pick, and whether CH6 itself is open.
  const [attachedClip, setAttachedClip] = useState<ComposerAttachedClip | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  // "Only one embedded clip plays at a time" — the message id whose embed
  // is currently active, across the whole visible list.
  const [activeClipMessageId, setActiveClipMessageId] = useState<string | null>(null);

  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportConfirmation, setReportConfirmation] = useState<ReportConfirmationState | null>(
    null,
  );
  // ADR-0017 Part E — the clip-report parallel of the three states above.
  const [clipReportTarget, setClipReportTarget] = useState<ClipReportTarget | null>(null);
  const [clipReportSubmitting, setClipReportSubmitting] = useState(false);
  const [clipReportConfirmation, setClipReportConfirmation] =
    useState<ClipReportConfirmationState | null>(null);
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'blocked-list'>('chat');

  const scrollRef = useRef<ScrollView>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasOpenedRef = useRef(false);
  // ADR-0017 Part E, flow doc's 3-case "clip unavailable" placeholder
  // logic, case 2 — every message id this device has ever seen (this
  // session only, never persisted) with a populated `clip`, updated
  // whenever `fetchInitial`/`pollForNew`/a successful send merges in a
  // message that carries one. Read by `showClipPlaceholder` below.
  const seenWithClipRef = useRef<Set<string>>(new Set());
  // Guards against overlapping pollForNew calls -- the 5s interval and the
  // AppState 'active' handler below can both fire close together (on web
  // especially: react-native-web's AppState maps to browser focus/
  // visibilitychange events, which fire far more often/unreliably than a
  // real native foreground transition). Originally added because two
  // concurrent calls under the old `after`-cursor design could both fetch
  // and append the same "new" message -- confirmed live 2026-07-26 as
  // messages visibly repeating in the feed. `pollForNew` now merges by id
  // (see below), which independently closes that specific bug, but this
  // guard still avoids two redundant in-flight requests for the same
  // fixed-window fetch.
  const pollInFlightRef = useRef(false);

  // Screen CH0 — checked once on mount.
  useEffect(() => {
    void getHasSeenChatIntro().then(setHasSeenIntroState);
  }, []);

  // Player's own consent status — fetched directly (not reused from
  // AppShell's cached copy) so it stays fresh across a foreground return,
  // same as HomeScreen's own independent `getMe` fetch.
  const fetchConsentStatus = useCallback(async () => {
    try {
      const me = await getMe();
      setConsentStatus(me.player.consentStatus);
      setTeamJoinStatus(me.player.teamJoinStatus);
    } catch {
      // Non-critical for this screen — a stale consent status just means
      // the compose box's locked state is one foreground-check behind; the
      // 403 handler on send is the real, authoritative gate.
    }
  }, []);

  useEffect(() => {
    void fetchConsentStatus();
  }, [fetchConsentStatus]);

  // ADR-0017 Part E — records every message id seen so far this session
  // with a populated `clip`, for the placeholder logic's case 2.
  const trackClipSeen = (msgs: ChatMessage[]) => {
    for (const m of msgs) {
      if (m.clip !== null) seenWithClipRef.current.add(m.id);
    }
  };

  const fetchInitial = useCallback(async () => {
    try {
      const response = await getChatMessages(teamId, { limit: 50 });
      trackClipSeen(response.messages);
      setMessages(response.messages);
      setLoadError(null);
    } catch {
      setLoadError(t('ch1.loadError'));
    }
  }, [teamId, t]);

  // Re-fetches the most recent window on every tick — not an incremental
  // `after` cursor — so an already-rendered message's `clip` (and
  // `reportedByMe`) field is re-resolved live, not appended once and left
  // stale forever. Code-critic finding, 2026-07-31: an `after`-cursor poll
  // only ever appends messages the client hasn't seen yet, so a clip that
  // gets hard-deleted, report-hidden, or whose uploader gets blocked *while
  // a message referencing it is already rendered on an open device* never
  // re-resolves to `clip: null` there until the player leaves and reopens
  // the tab (which does a full `fetchInitial`) — silently breaking
  // ADR-0017 Decision 2's "takes effect instantly and uniformly" guarantee
  // for exactly the case (an already-open chat) it matters most for.
  // Messages older than this fetch's 50-row window are left untouched, not
  // reconciled — the same accepted staleness the screen's "rolling window,
  // no backward pagination" design already has for anything off-window.
  //
  // Merges field-by-field rather than swapping in the fresh message
  // wholesale: `playbackUrl` is re-presigned fresh on *every* response
  // (per ADR-0010 Decision 2) even when the underlying clip hasn't
  // changed, and `ClipEmbed`'s `useVideoPlayer` re-initializes (confirmed
  // via `expo-video`'s own source: it memoizes on
  // `JSON.stringify(source)`, a value, not a reference) whenever that
  // string differs — so replacing an unchanged clip's object every 5s
  // would restart playback out from under anyone actively watching it.
  // Only two transitions are ever applied to an already-rendered message:
  // `clip` flipping from populated to `null` (the actual staleness bug
  // being fixed) and `reportedByMe` changing — anything else keeps the
  // exact existing object, `playbackUrl` included.
  const pollForNew = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const response = await getChatMessages(teamId, { limit: 50 });
      if (response.messages.length > 0) {
        trackClipSeen(response.messages);
        setMessages((prev) => {
          const freshById = new Map(response.messages.map((m) => [m.id, m]));
          const reconciled = (prev ?? []).map((m) => {
            const fresh = freshById.get(m.id);
            if (!fresh) return m;
            const clipBecameUnavailable = m.clip !== null && fresh.clip === null;
            const reportedByMeChanged = m.reportedByMe !== fresh.reportedByMe;
            if (!clipBecameUnavailable && !reportedByMeChanged) return m;
            return {
              ...m,
              clip: clipBecameUnavailable ? null : m.clip,
              reportedByMe: fresh.reportedByMe,
            };
          });
          const knownIds = new Set(reconciled.map((m) => m.id));
          const newOnes = response.messages.filter((m) => !knownIds.has(m.id));
          return [...reconciled, ...newOnes];
        });
      }
    } catch {
      // Silent — the next 5s poll simply retries.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [teamId]);

  useEffect(() => {
    void fetchInitial();
  }, [fetchInitial]);

  // Cleared the moment the tab is opened, per the flow doc — not on
  // scrolling to the bottom.
  useEffect(() => {
    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;
    void setChatLastViewedAt(teamId, new Date().toISOString());
    onOpened();
  }, [teamId, onOpened]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(() => {
      void pollForNew();
    }, POLL_INTERVAL_MS);
  }, [pollForNew]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        startPolling();
        void pollForNew();
      } else {
        stopPolling();
      }
    });
    return () => subscription.remove();
  }, [startPolling, stopPolling, pollForNew]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages]);

  const handleDismissIntro = () => {
    void setHasSeenChatIntro();
    setHasSeenIntroState(true);
  };

  const handleSend = async () => {
    const content = composeText.trim();
    // ADR-0017 Decision 4 — a message needs non-empty text OR an attached
    // clip (or both), not text alone.
    if (!content && !attachedClip) return;
    setSending(true);
    setSendError(null);
    try {
      const body: PostChatMessageRequest = attachedClip
        ? { content, clipId: attachedClip.clipId }
        : { content };
      const response = await postChatMessage(teamId, body);
      const newMessage: ChatMessage = { ...response, reportedByMe: false };
      if (newMessage.clip !== null) seenWithClipRef.current.add(newMessage.id);
      setMessages((prev) => [...(prev ?? []), newMessage]);
      setComposeText('');
      setAttachedClip(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'message_rejected_by_filter') {
        setSendError(t('ch1.filterRejected'));
      } else if (err instanceof ApiError && err.code === 'chat_send_rate_limited') {
        setSendError(t('ch1.sendRateLimited'));
      } else if (err instanceof ApiError && err.code === 'consent_required') {
        setConsentStatus('pending');
      } else if (err instanceof ApiError && err.code === 'clip_not_found') {
        // ADR-0017 Decision 5 — the picked clip became unavailable between
        // CH6 and Send. Typed text is preserved (same rule as every other
        // send error); only the clip chip is removed, so the player can
        // immediately retry with the text alone.
        setAttachedClip(null);
        setToastMessage(t('ch1.clipGoneOnSend'));
      } else {
        setSendError(t('ch1.genericError'));
      }
    } finally {
      setSending(false);
    }
  };

  const handleTapBody = (messageId: string) => {
    setRevealedMessageId((prev) => (prev === messageId ? null : messageId));
  };

  const handleTapReportMessage = (message: ChatMessage) => {
    setRevealedMessageId(null);
    setReportTarget(message);
  };

  // ADR-0017 Part E — "Rapportera klippet," reusing the existing clip-report
  // endpoint (V9/V10) with the `clipId` already known from `message.clip`.
  // Only ever reachable when `MessageBubble` has already computed
  // `canReportClip` (a clip is present and its uploader isn't the viewer).
  const handleTapReportClip = (message: ChatMessage) => {
    if (!message.clip) return;
    setRevealedMessageId(null);
    setClipReportTarget({
      clipId: message.clip.clipId,
      uploaderPlayerId: message.clip.uploaderPlayerId,
      uploaderScreenName: message.clip.uploaderScreenName,
      uploaderAvatarId: message.clip.uploaderAvatarId,
    });
  };

  const handleReportSubmit = async (reason: ChatReportReason, note: string | undefined) => {
    if (!reportTarget) return;
    // A system message is never reportable (MessageBubble's canReportMessage
    // gates the report affordance on !isSystem), so senderPlayerId/etc. are
    // guaranteed real here in practice — this guard makes that provable to
    // TypeScript rather than asserting it, and stays safe if that invariant
    // ever changes.
    if (!reportTarget.senderPlayerId || !reportTarget.senderScreenName
      || !reportTarget.senderAvatarId) {
      setReportTarget(null);
      return;
    }
    setReportSubmitting(true);
    try {
      await reportChatMessage(teamId, reportTarget.id, { reason, note });
      setMessages(
        (prev) =>
          prev?.map((m) => (m.id === reportTarget.id ? { ...m, reportedByMe: true } : m)) ?? prev,
      );
      setReportConfirmation({
        reason,
        senderPlayerId: reportTarget.senderPlayerId,
        senderScreenName: reportTarget.senderScreenName,
        senderAvatarId: reportTarget.senderAvatarId,
      });
      setReportTarget(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'chat_message_not_found') {
        setToastMessage(t('ch1.messageNotFoundToast'));
        setReportTarget(null);
        void fetchInitial();
      } else if (err instanceof ApiError && err.code === 'chat_message_already_reported_by_you') {
        setToastMessage(t('ch1.alreadyReportedToast'));
        setReportTarget(null);
      } else if (err instanceof ApiError && err.code === 'chat_report_rate_limited') {
        setToastMessage(t('ch1.reportRateLimitedToast'));
        setReportTarget(null);
      } else {
        setToastMessage(t('ch1.genericError'));
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  // ADR-0017 Part E / Decision 6 — a fully independent report flow from
  // `handleReportSubmit` above: same `POST .../clips/:clipId/report`
  // `ClipsScreen` already calls, unmodified. On success, the clip is
  // hidden for the whole team immediately (ADR-0010 Decision 4) — reflect
  // that locally right away on *every* message currently referencing this
  // clipId (any teammate's clip can be attached to more than one message),
  // the same "don't wait for the next poll" posture `ClipsScreen`'s own
  // handler already uses for the feed.
  const handleClipReportSubmit = async (reason: ClipReportReason, note: string | undefined) => {
    if (!clipReportTarget) return;
    setClipReportSubmitting(true);
    try {
      await reportClip(teamId, clipReportTarget.clipId, { reason, note });
      setMessages(
        (prev) =>
          prev?.map((m) =>
            m.clip?.clipId === clipReportTarget.clipId ? { ...m, clip: null } : m,
          ) ?? prev,
      );
      setClipReportConfirmation({
        reason,
        uploaderPlayerId: clipReportTarget.uploaderPlayerId,
        uploaderScreenName: clipReportTarget.uploaderScreenName,
        uploaderAvatarId: clipReportTarget.uploaderAvatarId,
      });
      setClipReportTarget(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'clip_not_found') {
        setToastMessage(t('ch1.clipNotFoundToast'));
        setClipReportTarget(null);
        void fetchInitial();
      } else if (err instanceof ApiError && err.code === 'clip_already_reported_by_you') {
        setToastMessage(t('ch1.clipAlreadyReportedToast'));
        setClipReportTarget(null);
      } else if (err instanceof ApiError && err.code === 'clip_report_rate_limited') {
        setToastMessage(t('ch1.clipReportRateLimitedToast'));
        setClipReportTarget(null);
      } else {
        setToastMessage(t('ch1.genericError'));
      }
    } finally {
      setClipReportSubmitting(false);
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
      // ADR-0017 Decision 2 — a block spans both chat messages and clip
      // uploads, extended here to the embed case: any message sent by the
      // blocked player disappears entirely (unchanged), and any *other*
      // message whose embedded clip was uploaded by the blocked player
      // (a different person than the message's own sender, per Decision 3)
      // loses just its embed, same as a later poll would already return
      // from the server's own per-viewer block filter.
      setMessages(
        (prev) =>
          prev
            ?.filter((m) => m.senderPlayerId !== target.playerId)
            .map((m) => (m.clip?.uploaderPlayerId === target.playerId ? { ...m, clip: null } : m)) ??
          prev,
      );
      setToastMessage(t('ch1.blockedToast', { screenName: target.screenName }));
    } catch {
      setToastMessage(t('ch1.genericError'));
    } finally {
      setBlockSubmitting(false);
    }
  };

  const handleTapSender = (message: ChatMessage) => {
    // A system message has no tappable sender (MessageBubble omits the
    // sender row entirely for authorType === 'system'), so this is never
    // actually invoked with null sender fields — guard rather than assert,
    // same reasoning as handleReportSubmit above.
    if (!message.senderPlayerId || !message.senderScreenName || !message.senderAvatarId) return;
    setBlockTarget({
      playerId: message.senderPlayerId,
      screenName: message.senderScreenName,
      avatarId: message.senderAvatarId,
    });
  };

  // ADR-0017 Part E — the clip embed's own "Klipp av {uploaderScreenName}"
  // line, a third tap target opening the identical BlockSheet flow but
  // targeting the *clip's* uploader, not the message's sender (frequently
  // a different person, per Decision 3).
  const handleTapClipUploader = (message: ChatMessage) => {
    if (!message.clip) return;
    setBlockTarget({
      playerId: message.clip.uploaderPlayerId,
      screenName: message.clip.uploaderScreenName,
      avatarId: message.clip.uploaderAvatarId,
    });
  };

  const handleBlockSheetConfirm = async () => {
    if (!blockTarget) return;
    await performBlock(blockTarget);
    setBlockTarget(null);
  };

  const handleReportConfirmationBlock = async () => {
    if (!reportConfirmation) return;
    await performBlock({
      playerId: reportConfirmation.senderPlayerId,
      screenName: reportConfirmation.senderScreenName,
      avatarId: reportConfirmation.senderAvatarId,
    });
    setReportConfirmation(null);
  };

  const handleClipReportConfirmationBlock = async () => {
    if (!clipReportConfirmation) return;
    await performBlock({
      playerId: clipReportConfirmation.uploaderPlayerId,
      screenName: clipReportConfirmation.uploaderScreenName,
      avatarId: clipReportConfirmation.uploaderAvatarId,
    });
    setClipReportConfirmation(null);
  };

  // ADR-0017 Part E, flow doc's 3-case placeholder logic — cases 1/2 are a
  // free logical inference plus the per-session `seenWithClipRef` set;
  // case 3 (never seen this messageId with a clip, most likely a hard
  // delete from a cold start) is the explicitly-accepted gap, rendered as
  // an ordinary text message.
  const showClipPlaceholder = (message: ChatMessage) => {
    if (message.clip !== null) return false;
    if (message.content.trim() === '') return true;
    return seenWithClipRef.current.has(message.id);
  };

  if (view === 'blocked-list') {
    return <BlockedListScreen teamId={teamId} onBack={() => setView('chat')} />;
  }

  if (hasSeenIntro === null) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.flame} size="large" />
      </View>
    );
  }

  if (hasSeenIntro === false) {
    return <ChatIntroCard onDismiss={handleDismissIntro} />;
  }

  const locked =
    (consentStatus !== null && consentStatus !== 'approved') ||
    (teamJoinStatus !== null && teamJoinStatus !== 'approved');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      // No fixed header/nav bar above this screen (AppShell's tab bar is
      // at the bottom, which doesn't need offsetting) -- 0 is correct, not
      // a placeholder.
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <Text style={styles.heading}>{t('ch1.heading')}</Text>
        <Pressable accessibilityRole="button" onPress={() => setView('blocked-list')}>
          <Text style={styles.blockedLink}>{t('ch1.blockedLink')}</Text>
        </Pressable>
      </View>

      {messages === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.flame} size="large" />
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Text style={styles.retryText} onPress={() => void fetchInitial()}>
            {t('ch1.retry')}
          </Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyHeading}>{t('ch1.emptyHeading')}</Text>
          <Text style={styles.emptySub}>{t('ch1.emptySub')}</Text>
        </View>
      ) : (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.list}>
          {messages.map((message) => {
            const isOwn = message.senderPlayerId === viewerPlayerId;
            return (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={isOwn}
                viewerPlayerId={viewerPlayerId}
                reportRevealed={revealedMessageId === message.id}
                showClipPlaceholder={showClipPlaceholder(message)}
                isClipActive={activeClipMessageId === message.id}
                onClipActivate={() => setActiveClipMessageId(message.id)}
                onTapBody={() => handleTapBody(message.id)}
                onTapReportMessage={() => handleTapReportMessage(message)}
                onTapReportClip={() => handleTapReportClip(message)}
                onTapSender={() => handleTapSender(message)}
                onTapClipUploader={() => handleTapClipUploader(message)}
              />
            );
          })}
        </ScrollView>
      )}

      <ComposeBar
        value={composeText}
        onChangeText={(text) => {
          setComposeText(text);
          if (sendError) setSendError(null);
        }}
        onSend={() => void handleSend()}
        sending={sending}
        locked={locked}
        filterErrorText={sendError}
        attachedClip={attachedClip}
        onOpenClipPicker={() => setPickerVisible(true)}
        onRemoveClip={() => setAttachedClip(null)}
        onLockedAttachTap={(message) => setToastMessage(message)}
      />

      <ClipAttachSheet
        visible={pickerVisible}
        teamId={teamId}
        onSelect={(clip: ClipFeedItem) => {
          setAttachedClip({
            clipId: clip.clipId,
            uploaderScreenName: clip.uploaderScreenName,
            playbackUrl: clip.playbackUrl,
          });
          setPickerVisible(false);
        }}
        onClose={() => setPickerVisible(false)}
        onGoToClipsTab={() => {
          setPickerVisible(false);
          onGoToClipsTab();
        }}
      />

      <ReportSheet
        visible={reportTarget !== null}
        messageExcerpt={(reportTarget?.content ?? '').slice(0, REPORT_EXCERPT_LENGTH)}
        loading={reportSubmitting}
        onSubmit={(reason, note) => void handleReportSubmit(reason, note)}
        onClose={() => setReportTarget(null)}
      />

      <ReportConfirmationSheet
        visible={reportConfirmation !== null}
        reason={reportConfirmation?.reason ?? 'other'}
        reportedScreenName={reportConfirmation?.senderScreenName ?? ''}
        onBlock={() => void handleReportConfirmationBlock()}
        onDone={() => setReportConfirmation(null)}
      />

      <ClipReportSheet
        visible={clipReportTarget !== null}
        loading={clipReportSubmitting}
        onSubmit={(reason, note) => void handleClipReportSubmit(reason, note)}
        onClose={() => setClipReportTarget(null)}
      />

      <ClipReportConfirmationSheet
        visible={clipReportConfirmation !== null}
        reason={clipReportConfirmation?.reason ?? 'other'}
        reportedScreenName={clipReportConfirmation?.uploaderScreenName ?? ''}
        onBlock={() => void handleClipReportConfirmationBlock()}
        onDone={() => setClipReportConfirmation(null)}
      />

      <BlockSheet
        visible={blockTarget !== null}
        screenName={blockTarget?.screenName ?? ''}
        loading={blockSubmitting}
        onConfirm={() => void handleBlockSheetConfirm()}
        onClose={() => setBlockTarget(null)}
      />

      {toastMessage ? <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  blockedLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.textMuted,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  emptyHeading: {
    fontFamily: fonts.headingBold,
    fontSize: 16,
    color: colors.ink,
  },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
