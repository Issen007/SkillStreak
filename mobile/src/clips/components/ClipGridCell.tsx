import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PausedClipThumbnail } from '../../chat/components/PausedClipThumbnail';
import { Avatar } from '../../components/Avatar';
import { formatClipRelativeTime } from '../../utils/formatDate';
import { colors } from '../../theme/colors';
import { CLIP_ASPECT_RATIO } from '../constants';
import type { ClipFeedItem } from '../../api/types';

interface ClipGridCellProps {
  clip: ClipFeedItem;
  /** Computed by `ClipGrid` off its own measured row width — see that
   * component's comment for why this isn't derived from
   * `useWindowDimensions` here. */
  width: number;
  onPress: () => void;
}

/** One cell of Screen V2 (revised)'s 3-column grid
 * (docs/design/clip-library-grid.md §1). Static poster frame only — reuses
 * `PausedClipThumbnail` verbatim, the same "mount a paused `VideoView` so
 * it renders frame 0" technique already used at two other call sites, not
 * a new one. No autoplay, no visible text (screen name/caption/timestamp
 * all move to the modal) — just a permanent play affordance and two
 * icon-only corner badges, since a cell this small can't fit text without
 * i18n-string-length-dependent truncation. The whole cell is the tap
 * target, not a small icon inside it. */
export function ClipGridCell({ clip, width, onPress }: ClipGridCellProps) {
  const { t } = useTranslation('clips');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('clipGridCell.a11yLabel', {
        screenName: clip.uploaderScreenName,
        timeAgo: formatClipRelativeTime(clip.createdAt),
      })}
      onPress={onPress}
      style={[styles.cell, { width }]}
    >
      <PausedClipThumbnail playbackUrl={clip.playbackUrl} style={styles.thumbnail} />

      <View pointerEvents="none" style={styles.playOverlay}>
        <Text style={styles.playIcon}>▶</Text>
      </View>

      <View pointerEvents="none" style={styles.avatarBadge}>
        <Avatar avatarId={clip.uploaderAvatarId} size={13} />
      </View>

      {clip.taggedPlayerId ? (
        <View pointerEvents="none" style={styles.challengeBadge}>
          <Text style={styles.challengeIcon}>🎯</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    aspectRatio: CLIP_ASPECT_RATIO,
    borderRadius: 10,
    backgroundColor: colors.ink,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  // Unconditional (unlike ClipCard's own play icon, which only shows while
  // paused) — a grid cell is never "playing," so a frozen frame always
  // needs this to read as "tap to watch," not a plain photo.
  playOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.85)',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  avatarEmoji: {
    fontSize: 10,
  },
  challengeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeIcon: {
    fontSize: 10,
  },
});
