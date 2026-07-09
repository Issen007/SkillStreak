import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChatIntroCard } from './components/ChatIntroCard';
import { MessageBubble } from './components/MessageBubble';
import { ComposeBar } from './components/ComposeBar';
import { ReportSheet } from './components/ReportSheet';
import { ReportConfirmationSheet } from './components/ReportConfirmationSheet';
import { BlockSheet } from './components/BlockSheet';
import { BlockedListScreen } from './BlockedListScreen';
import {
  blockChatPlayer,
  getChatMessages,
  getMe,
  postChatMessage,
  reportChatMessage,
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
import type { ChatMessage, ChatReportReason, ConsentStatus } from '../api/types';

interface ChatScreenProps {
  teamId: string;
  viewerPlayerId: string;
  /** Called once on mount — lets AppShell clear the "Chatt" tab's unread
   * dot the moment this tab is actually opened (not on scrolling to the
   * bottom), per the flow doc's "Unread indicator" note. */
  onOpened: () => void;
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

/** Screens CH0/CH1 — the "Chatt" tab. `GET .../chat/messages` on open,
 * then polled every ~5s while this screen is focused, paused entirely
 * when backgrounded (ADR-0007 Decision 5's "boring, no WebSocket" choice)
 * — since AppShell fully unmounts an inactive tab (no keep-alive), "focused"
 * here is simply "mounted," so a tab switch away already stops the poll;
 * an `AppState` listener additionally pauses/resumes it across
 * backgrounding. No backward pagination exists in the contract — this is a
 * rolling window of the most recent messages, not a searchable archive
 * (deliberate, per the flow doc's judgment call 11). */
export function ChatScreen({ teamId, viewerPlayerId, onOpened }: ChatScreenProps) {
  const [hasSeenIntro, setHasSeenIntroState] = useState<boolean | null>(null);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus | null>(null);

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportConfirmation, setReportConfirmation] = useState<ReportConfirmationState | null>(
    null,
  );
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [view, setView] = useState<'chat' | 'blocked-list'>('chat');

  const latestCreatedAtRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<ScrollView>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasOpenedRef = useRef(false);

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
    } catch {
      // Non-critical for this screen — a stale consent status just means
      // the compose box's locked state is one foreground-check behind; the
      // 403 handler on send is the real, authoritative gate.
    }
  }, []);

  useEffect(() => {
    void fetchConsentStatus();
  }, [fetchConsentStatus]);

  const fetchInitial = useCallback(async () => {
    try {
      const response = await getChatMessages(teamId, { limit: 50 });
      setMessages(response.messages);
      const last = response.messages[response.messages.length - 1];
      latestCreatedAtRef.current = last?.createdAt;
      setLoadError(null);
    } catch {
      setLoadError('Kunde inte hämta lagchatten. Kolla din uppkoppling.');
    }
  }, [teamId]);

  const pollForNew = useCallback(async () => {
    try {
      const response = await getChatMessages(teamId, {
        after: latestCreatedAtRef.current,
        limit: 50,
      });
      if (response.messages.length > 0) {
        setMessages((prev) => [...(prev ?? []), ...response.messages]);
        latestCreatedAtRef.current = response.messages[response.messages.length - 1].createdAt;
      }
    } catch {
      // Silent — the next 5s poll simply retries.
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
    if (!content) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await postChatMessage(teamId, { content });
      const newMessage: ChatMessage = { ...response, reportedByMe: false };
      setMessages((prev) => [...(prev ?? []), newMessage]);
      latestCreatedAtRef.current = newMessage.createdAt;
      setComposeText('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'message_rejected_by_filter') {
        setSendError(
          'Meddelandet skickades inte — det innehöll ord som inte funkar här. Skriv om det så går det bra! ✍️',
        );
      } else if (err instanceof ApiError && err.code === 'chat_send_rate_limited') {
        setSendError(
          'Du skickar meddelanden lite snabbt just nu. Vänta en liten stund så går det bra igen.',
        );
      } else if (err instanceof ApiError && err.code === 'consent_required') {
        setConsentStatus('pending');
      } else {
        setSendError('Något gick fel. Testa igen.');
      }
    } finally {
      setSending(false);
    }
  };

  const handleTapBody = (messageId: string) => {
    setRevealedMessageId((prev) => (prev === messageId ? null : messageId));
  };

  const handleTapReport = (message: ChatMessage) => {
    setRevealedMessageId(null);
    setReportTarget(message);
  };

  const handleReportSubmit = async (reason: ChatReportReason, note: string | undefined) => {
    if (!reportTarget) return;
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
        setToastMessage('Det där meddelandet finns inte längre.');
        setReportTarget(null);
        void fetchInitial();
      } else if (err instanceof ApiError && err.code === 'chat_message_already_reported_by_you') {
        setToastMessage('Du har redan rapporterat det här meddelandet.');
        setReportTarget(null);
      } else if (err instanceof ApiError && err.code === 'chat_report_rate_limited') {
        setToastMessage(
          'Du har rapporterat en del på sistone. Vänta en liten stund innan du rapporterar igen.',
        );
        setReportTarget(null);
      } else {
        setToastMessage('Något gick fel. Testa igen.');
      }
    } finally {
      setReportSubmitting(false);
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
      setMessages((prev) => prev?.filter((m) => m.senderPlayerId !== target.playerId) ?? prev);
      setToastMessage(`Du ser inte längre meddelanden från ${target.screenName}.`);
    } catch {
      setToastMessage('Något gick fel. Testa igen.');
    } finally {
      setBlockSubmitting(false);
    }
  };

  const handleTapSender = (message: ChatMessage) => {
    setBlockTarget({
      playerId: message.senderPlayerId,
      screenName: message.senderScreenName,
      avatarId: message.senderAvatarId,
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

  const locked = consentStatus !== null && consentStatus !== 'approved';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Lagchatt 💬</Text>
        <Pressable accessibilityRole="button" onPress={() => setView('blocked-list')}>
          <Text style={styles.blockedLink}>🚫 Blockerade</Text>
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
            Försök igen
          </Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyHeading}>Inga meddelanden än</Text>
          <Text style={styles.emptySub}>Skriv det första meddelandet till laget!</Text>
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
                reportRevealed={revealedMessageId === message.id}
                onTapBody={() => handleTapBody(message.id)}
                onTapReport={() => handleTapReport(message)}
                onTapSender={() => handleTapSender(message)}
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

      <BlockSheet
        visible={blockTarget !== null}
        screenName={blockTarget?.screenName ?? ''}
        loading={blockSubmitting}
        onConfirm={() => void handleBlockSheetConfirm()}
        onClose={() => setBlockTarget(null)}
      />
    </View>
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
