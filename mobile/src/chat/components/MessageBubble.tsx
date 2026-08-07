import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ClipEmbed } from './ClipEmbed';
import { ClipUnavailablePlaceholder } from './ClipUnavailablePlaceholder';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';
import { formatChatTimestamp } from '../../utils/formatDate';
import type { ChatMessage } from '../../api/types';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  viewerPlayerId: string;
  /** Tap-to-reveal, not long-press (per the flow doc's judgment call 6) —
   * whether the report link(s) are currently shown under this particular
   * message. Only ever true for one message at a time (parent owns this
   * as a single `revealedMessageId`). */
  reportRevealed: boolean;
  /** ADR-0017 Part E's 3-case "clip unavailable" placeholder logic — a
   * free logical inference plus a per-session "seen with a clip" set,
   * both computed by `ChatScreen` (needs cross-message/poll-history state
   * this component doesn't have). */
  showClipPlaceholder: boolean;
  /** "Only one embedded clip plays at a time" — whether *this* message's
   * clip is the currently-active one. */
  isClipActive: boolean;
  onClipActivate: () => void;
  onTapBody: () => void;
  onTapReportMessage: () => void;
  onTapReportClip: () => void;
  /** Tapping the avatar/screen name (not the body) opens Screen CH4 — a
   * physically different tap target on purpose, per the flow doc's
   * judgment call 7. Never available on the viewer's own messages. */
  onTapSender: () => void;
  /** The clip embed's own "Klipp av {uploaderScreenName}" line — a third,
   * spatially separate tap target opening CH4 for the *clip's* uploader,
   * per this addendum's judgment call 25. */
  onTapClipUploader: () => void;
}

/** Screen CH1's message row. Own messages: right-aligned, `pausedBg`/
 * `pausedBorder` fill (a soft neutral lavender — deliberately not
 * `flame`/`gold`, both protected "mine"/"ours" motifs per style-guide.md;
 * this exact color already appears in docs/design/phase2.6-2.7-mockup.html's
 * own `.msg-row.mine .msg-bubble`, confirmed not to read as alarming here
 * despite also meaning "paused consent" elsewhere in this app — the tone
 * is neutral/soft, not warning-colored, in either context).
 *
 * ADR-0017 Part E: text and a clip render together in one bubble (never
 * either/or), and the tap-to-reveal report zone now shows up to *two*
 * buttons — "Rapportera meddelandet" and/or "Rapportera klippet" — driven
 * by "reporting yourself protects no one," applied independently to the
 * message's sender and the clip's uploader (frequently different people,
 * since any teammate can attach any team clip). See the flow doc's
 * decision table; the four booleans below reproduce it exactly. */
export function MessageBubble({
  message,
  isOwn,
  viewerPlayerId,
  reportRevealed,
  showClipPlaceholder,
  isClipActive,
  onClipActivate,
  onTapBody,
  onTapReportMessage,
  onTapReportClip,
  onTapSender,
  onTapClipUploader,
}: MessageBubbleProps) {
  const { t } = useTranslation('chat');
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === message.senderAvatarId)?.emoji ?? '🙂';
  const timestamp = formatChatTimestamp(message.createdAt);

  // ADR-0021 Decision 2 — checked *before* any `isOwn` branching below:
  // `isOwn` (`senderPlayerId === viewerPlayerId`) is `false` for a system
  // row (its sender is `null` from creation), so without this the
  // announcement would silently fall through to the ordinary left-aligned
  // white "teammate message" treatment, which is exactly what Decision 2/3
  // rule out.
  const isSystem = message.authorType === 'system';

  const clip = message.clip;
  const clipUploaderIsViewer = clip !== null && clip.uploaderPlayerId === viewerPlayerId;
  // The client-side mirror of the backend's binding report-rejection guard
  // (ADR-0021 Decision 3 / the security-reviewer addendum's finding 1) —
  // belt-and-suspenders: the server 400s a report against a system row
  // regardless, but the UI should never *offer* an action guaranteed to
  // fail. Reporting the attached *clip* is unaffected (it has a real
  // uploader) and keeps working exactly as on any other message.
  const canReportMessage = !isOwn && !isSystem;
  const canReportClip = clip !== null && !clipUploaderIsViewer;
  const canReportSomething = canReportMessage || canReportClip;
  const showAttribution = clip !== null && clip.uploaderPlayerId !== message.senderPlayerId;

  return (
    <View
      style={[
        styles.row,
        isSystem ? styles.rowSystem : isOwn ? styles.rowMine : styles.rowTheirs,
      ]}
    >
      {/* No avatar/sender-name row on a system message, and no "SYSTEM"
          label replacing it: the templated sentence already names both
          players in plain language, so a label on top of that would be
          noise. The centered layout + distinct fill carry the "not a
          person" reading visually; the accessibilityLabel below carries it
          for a screen reader, which can't infer it from layout. */}
      {!isOwn && !isSystem ? (
        <Pressable onPress={onTapSender} accessibilityRole="button" style={styles.senderRow}>
          <Text style={styles.senderEmoji}>{emoji}</Text>
          <Text style={styles.senderName}>{message.senderScreenName}</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={canReportSomething ? onTapBody : undefined}
        accessibilityRole={canReportSomething ? 'button' : undefined}
        accessibilityLabel={
          isSystem ? t('systemMessage.a11yPrefix', { content: message.content }) : undefined
        }
        style={[
          styles.bubble,
          isSystem ? styles.bubbleSystem : isOwn ? styles.bubbleMine : styles.bubbleTheirs,
        ]}
      >
        {message.content ? (
          <Text style={[styles.content, isSystem && styles.contentSystem]}>{message.content}</Text>
        ) : null}

        {clip ? (
          <ClipEmbed
            clip={clip}
            showAttribution={showAttribution}
            attributionTappable={clip.uploaderPlayerId !== viewerPlayerId}
            isActive={isClipActive}
            onActivate={onClipActivate}
            onTapAttribution={onTapClipUploader}
          />
        ) : showClipPlaceholder ? (
          <ClipUnavailablePlaceholder />
        ) : null}
      </Pressable>

      <Text style={styles.time}>{timestamp}</Text>

      {reportRevealed ? (
        <View style={styles.reportRow}>
          {canReportMessage ? (
            <Pressable onPress={onTapReportMessage} accessibilityRole="button">
              <Text style={styles.reportLink}>{t('messageBubble.reportMessage')}</Text>
            </Pressable>
          ) : null}
          {canReportClip ? (
            <Pressable onPress={onTapReportClip} accessibilityRole="button">
              <Text style={styles.reportLink}>{t('messageBubble.reportClip')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    maxWidth: '82%',
    gap: 3,
  },
  rowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  /** ADR-0021 Decision 2's announcement row — centered, not edge-aligned:
   * a system message isn't "from" either side of the conversation. Wider
   * than the 82% both edge-anchored variants get, since it has no
   * conversational partner to leave room for. */
  rowSystem: {
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: '92%',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  senderEmoji: {
    fontSize: 13,
  },
  senderName: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.textMuted,
  },
  bubble: {
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    gap: 6,
  },
  bubbleTheirs: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: colors.pausedBg,
    borderWidth: 1,
    borderColor: colors.pausedBorder,
    borderTopRightRadius: 4,
  },
  bubbleSystem: {
    backgroundColor: colors.systemMessageBg,
    borderWidth: 1,
    borderColor: colors.systemMessageBorder,
    // Symmetric — no asymmetric "speech-bubble tail" corner the way
    // bubbleMine/bubbleTheirs have, since this bubble isn't pointing at
    // anyone.
    borderRadius: 14,
  },
  content: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  contentSystem: {
    textAlign: 'center',
  },
  time: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: colors.textMuted,
    paddingHorizontal: 4,
  },
  reportRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 4,
  },
  reportLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.error,
  },
});
