import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PausedClipThumbnail } from './PausedClipThumbnail';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { Avatar } from '../../components/Avatar';
import { formatClipRelativeTime } from '../../utils/formatDate';
import type { ClipFeedItem } from '../../api/types';

interface ClipPickerCardProps {
  clip: ClipFeedItem;
  onSelect: () => void;
}

/** Screen CH6's grid card — deliberately *not* tappable-to-preview (per
 * the flow doc): a single tap anywhere on the card selects and attaches
 * this clip immediately, closing the sheet. Paused-first-frame, muted, no
 * play/pause control of its own — this is a picker, not a player. */
export function ClipPickerCard({ clip, onSelect }: ClipPickerCardProps) {

  return (
    <Pressable onPress={onSelect} accessibilityRole="button" style={styles.card}>
      <View style={styles.thumbWrap}>
        <PausedClipThumbnail playbackUrl={clip.playbackUrl} style={styles.thumb} />
      </View>
      <View style={styles.metaRow}>
        <Avatar avatarId={clip.uploaderAvatarId} size={15} />
        <Text style={styles.uploaderName} numberOfLines={1}>
          {clip.uploaderScreenName}
        </Text>
      </View>
      <Text style={styles.timestamp}>{formatClipRelativeTime(clip.createdAt)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: colors.ink,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingTop: 7,
  },
  avatarEmoji: {
    fontSize: 12,
  },
  uploaderName: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.ink,
  },
  timestamp: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.textMuted,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 8,
  },
});
