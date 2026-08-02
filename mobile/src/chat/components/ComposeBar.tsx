import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PausedClipThumbnail } from './PausedClipThumbnail';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

const MAX_LENGTH = 500;
const COUNTER_THRESHOLD = 400;

/** The composer's attached-clip preview — just enough to render the chip
 * and send the request, not the full `ClipFeedItem` shape (`ChatScreen`
 * hangs onto that separately for the picker's own state). */
export interface ComposerAttachedClip {
  clipId: string;
  uploaderScreenName: string;
  playbackUrl: string;
}

interface ComposeBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** `403 consent_required` — a player whose parent hasn't approved yet.
   * The compose box stays visible but locked, same "don't hide the
   * feature, show it disabled" rule Phase 1's `TrainedButton` already
   * established for the same situation. */
  locked: boolean;
  /** `422 message_rejected_by_filter` inline error — typed text stays in
   * the input per the contract's explicit instruction, nothing is
   * cleared. */
  filterErrorText: string | null;
  /** ADR-0017 Part E — the clip picked in CH6, if any. */
  attachedClip: ComposerAttachedClip | null;
  onOpenClipPicker: () => void;
  onRemoveClip: () => void;
  /** Locked-state tap on the 🎬 button — surfaces the same existing toast
   * copy the text input/send button already imply via `lockedNote` below,
   * per the flow doc's "same lock treatment" instruction. */
  onLockedAttachTap: (message: string) => void;
}

/** Screen CH1's bottom-fixed compose box. Extended (ADR-0017 Part E) with a
 * 🎬 attach-clip button left of the text input and a removable clip-preview
 * chip above the row when a clip is attached. */
export function ComposeBar({
  value,
  onChangeText,
  onSend,
  sending,
  locked,
  filterErrorText,
  attachedClip,
  onOpenClipPicker,
  onRemoveClip,
  onLockedAttachTap,
}: ComposeBarProps) {
  const { t } = useTranslation('chat');
  const trimmed = value.trim();
  const overLimit = value.length > MAX_LENGTH;
  // ADR-0017 Decision 4 — enabled when EITHER non-empty text OR an
  // attached clip (or both), not text-only as Part B originally specified.
  const canSend = !locked && !sending && !overLimit && (trimmed.length > 0 || attachedClip !== null);
  const lockedNoteText = t('composeBar.lockedNote');

  const handleTapAttach = () => {
    if (locked) {
      onLockedAttachTap(lockedNoteText);
      return;
    }
    onOpenClipPicker();
  };

  return (
    <View style={styles.container}>
      {attachedClip ? (
        <View style={styles.clipChip}>
          <View style={styles.clipThumbWrap}>
            <PausedClipThumbnail playbackUrl={attachedClip.playbackUrl} style={styles.clipThumb} />
          </View>
          <Text style={styles.clipChipLabel} numberOfLines={1}>
            {t('composeBar.clipChipLabel', { screenName: attachedClip.uploaderScreenName })}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRemoveClip}
            hitSlop={10}
            style={styles.clipChipRemove}
          >
            <Text style={styles.clipChipRemoveIcon}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: locked }}
          onPress={handleTapAttach}
          style={[styles.attachButton, locked && styles.attachButtonLocked]}
        >
          <Text style={styles.attachIcon}>🎬</Text>
        </Pressable>

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={t('composeBar.placeholder')}
          placeholderTextColor={colors.textMuted}
          editable={!locked && !sending}
          multiline
          maxLength={MAX_LENGTH + 20}
          style={[styles.input, locked && styles.inputLocked]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          onPress={canSend ? onSend : undefined}
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        >
          <Text style={styles.sendIcon}>{locked ? '🔒' : '➤'}</Text>
        </Pressable>
      </View>

      {value.length > COUNTER_THRESHOLD ? (
        <Text style={[styles.counter, overLimit && styles.counterOver]}>
          {value.length}/{MAX_LENGTH}
        </Text>
      ) : null}

      {locked ? <Text style={styles.lockedNote}>{lockedNoteText}</Text> : null}

      {filterErrorText ? <Text style={styles.filterError}>{filterErrorText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 8,
  },
  bar: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachButtonLocked: {
    backgroundColor: colors.disabledBg,
    borderColor: colors.disabledBg,
  },
  attachIcon: {
    fontSize: 16,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    maxHeight: 90,
  },
  inputLocked: {
    color: colors.disabledText,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.flame,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.disabledBg,
  },
  sendIcon: {
    fontSize: 16,
    color: colors.white,
  },
  counter: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  counterOver: {
    color: colors.error,
  },
  lockedNote: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 15,
  },
  filterError: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.error,
    lineHeight: 15,
  },
  clipChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    maxWidth: '80%',
  },
  clipThumbWrap: {
    // ~60×80dp per the flow doc — big enough to recognize which clip it
    // is, small enough not to crowd the compose row.
    width: 60,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  clipThumb: {
    width: '100%',
    height: '100%',
  },
  clipChipLabel: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.ink,
  },
  clipChipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.disabledBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipChipRemoveIcon: {
    fontSize: 10,
    color: colors.ink,
  },
});
