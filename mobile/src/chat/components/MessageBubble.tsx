import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';
import { formatChatTimestamp } from '../../utils/formatDate';
import type { ChatMessage } from '../../api/types';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  /** Tap-to-reveal, not long-press (per the flow doc's judgment call 6) —
   * whether the "🚩 Rapportera" link is currently shown under this
   * particular message. Only ever true for one message at a time (parent
   * owns this as a single `revealedMessageId`). */
  reportRevealed: boolean;
  /** Tapping a teammate's message *body* toggles `reportRevealed` for this
   * message (never available on the viewer's own messages). */
  onTapBody: () => void;
  onTapReport: () => void;
  /** Tapping the avatar/screen name (not the body) opens Screen CH4 — a
   * physically different tap target on purpose, per the flow doc's
   * judgment call 7. Never available on the viewer's own messages. */
  onTapSender: () => void;
}

/** Screen CH1's message row. Own messages: right-aligned, `pausedBg`/
 * `pausedBorder` fill (a soft neutral lavender — deliberately not
 * `flame`/`gold`, both protected "mine"/"ours" motifs per style-guide.md;
 * this exact color already appears in docs/design/phase2.6-2.7-mockup.html's
 * own `.msg-row.mine .msg-bubble`, confirmed not to read as alarming here
 * despite also meaning "paused consent" elsewhere in this app — the tone
 * is neutral/soft, not warning-colored, in either context). */
export function MessageBubble({
  message,
  isOwn,
  reportRevealed,
  onTapBody,
  onTapReport,
  onTapSender,
}: MessageBubbleProps) {
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === message.senderAvatarId)?.emoji ?? '🙂';
  const timestamp = formatChatTimestamp(message.createdAt);

  return (
    <View style={[styles.row, isOwn ? styles.rowMine : styles.rowTheirs]}>
      {!isOwn ? (
        <Pressable onPress={onTapSender} accessibilityRole="button" style={styles.senderRow}>
          <Text style={styles.senderEmoji}>{emoji}</Text>
          <Text style={styles.senderName}>{message.senderScreenName}</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={isOwn ? undefined : onTapBody}
        accessibilityRole={isOwn ? undefined : 'button'}
        style={[styles.bubble, isOwn ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        <Text style={styles.content}>{message.content}</Text>
      </Pressable>

      <Text style={styles.time}>{timestamp}</Text>

      {reportRevealed ? (
        <Pressable onPress={onTapReport} accessibilityRole="button">
          <Text style={styles.reportLink}>🚩 Rapportera</Text>
        </Pressable>
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
  content: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  time: {
    fontFamily: fonts.body,
    fontSize: 9.5,
    color: colors.textMuted,
    paddingHorizontal: 4,
  },
  reportLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.error,
    paddingHorizontal: 4,
  },
});
