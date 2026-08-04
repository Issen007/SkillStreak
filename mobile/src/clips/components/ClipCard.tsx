import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';
import { formatClipRelativeTime } from '../../utils/formatDate';
import type { ClipFeedItem } from '../../api/types';

interface ClipCardProps {
  clip: ClipFeedItem;
  isOwn: boolean;
  /** Tap-to-reveal, not long-press (per the flow doc's judgment call 5,
   * extending chat's own rule) — whether the report/delete link is
   * currently shown under this particular card. Only ever true for one
   * card at a time (parent owns this as a single `revealedClipId`). */
  revealed: boolean;
  /** Zone 1 — avatar/name row. Only ever passed (and rendered as tappable)
   * for a teammate's clip, never your own. Opens the existing CH4 "Om
   * {screenName}" sheet. */
  onTapAvatar?: () => void;
  /** Zone 3 — caption/timestamp/"⋯" area. Toggles `revealed`. */
  onTapMeta: () => void;
  /** Zone 3's revealed action — "🚩 Rapportera" on a teammate's clip. */
  onTapReport?: () => void;
  /** Zone 3's revealed action — "🗑️ Ta bort klippet" on your own clip. */
  onTapDelete?: () => void;
}

/** Screen V2's clip card. Three physically separate tap zones, per the
 * flow doc's judgment call 5 — mirrors `MessageBubble`'s exact reasoning,
 * extended to a third zone so the video area itself never risks a kid
 * accidentally triggering report/delete while just trying to watch:
 * 1. Avatar/name row -> Screen CH4 (teammates only).
 * 2. Video area -> play/pause only, never an action menu.
 * 3. Caption/timestamp/"⋯" area -> reveals report (teammate) or delete
 *    (own) — never both on the same card. */
export function ClipCard({
  clip,
  isOwn,
  revealed,
  onTapAvatar,
  onTapMeta,
  onTapReport,
  onTapDelete,
}: ClipCardProps) {
  const { t } = useTranslation('clips');
  const emoji = AVATAR_CATALOG.find((a) => a.avatarId === clip.uploaderAvatarId)?.emoji ?? '🙂';

  // Muted by default (per the flow doc's playback-mechanics judgment call —
  // a kid's phone is often on silent at practice, and this also avoids an
  // unexpectedly loud clip in a locker room). Tap the small speaker icon to
  // unmute; tap the video area itself to play/pause only, never both from
  // the same gesture.
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const player = useVideoPlayer(clip.playbackUrl, (p) => {
    p.loop = false;
    p.muted = true;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    const subscription = player.addListener('playingChange', (payload: { isPlaying: boolean }) => {
      setIsPlaying(payload.isPlaying);
    });
    return () => subscription.remove();
  }, [player]);

  const handleTapVideo = () => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  return (
    <View style={styles.card}>
      {onTapAvatar ? (
        <Pressable onPress={onTapAvatar} accessibilityRole="button" style={styles.headerRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarEmoji}>{emoji}</Text>
          </View>
          <Text style={styles.name}>{clip.uploaderScreenName}</Text>
        </Pressable>
      ) : (
        <View style={styles.headerRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarEmoji}>{emoji}</Text>
          </View>
          <Text style={styles.name}>{clip.uploaderScreenName}</Text>
        </View>
      )}

      <Pressable onPress={handleTapVideo} accessibilityRole="button" style={styles.videoArea}>
        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          contentFit="cover"
        />
        {!isPlaying ? (
          <View pointerEvents="none" style={styles.playOverlay}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        ) : null}
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            setMuted((prev) => !prev);
          }}
          accessibilityRole="button"
          style={styles.muteButton}
        >
          <Text style={styles.muteIcon}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>
      </Pressable>

      {clip.taggedPlayerId && clip.taggedScreenName ? (
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {t('clipCard.challengeChip', { screenName: clip.taggedScreenName })}
          </Text>
        </View>
      ) : null}

      <Pressable onPress={onTapMeta} accessibilityRole="button" style={styles.metaZone}>
        {clip.caption ? <Text style={styles.caption}>{clip.caption}</Text> : null}
        <View style={styles.metaFooter}>
          <Text style={styles.timestamp}>{formatClipRelativeTime(clip.createdAt)}</Text>
          <Text style={styles.moreAffordance}>⋯</Text>
        </View>
      </Pressable>

      {revealed && !isOwn ? (
        <Pressable onPress={onTapReport} accessibilityRole="button" style={styles.actionRow}>
          <Text style={styles.reportLink}>{t('clipCard.report')}</Text>
        </Pressable>
      ) : null}
      {revealed && isOwn ? (
        <Pressable onPress={onTapDelete} accessibilityRole="button" style={styles.actionRow}>
          <Text style={styles.deleteLink}>{t('clipCard.delete')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    overflow: 'hidden',
    gap: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  avatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 14,
  },
  name: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  videoArea: {
    marginHorizontal: 12,
    // Clips are recorded portrait (9:16, per docs/design/phase3-flows.md) —
    // a fixed height here (previously 220) left the box's shape mismatched
    // against the source video on anything wider than a narrow phone
    // screen, and contentFit="cover" then crops to fill that mismatched
    // box. On web, where this card stretches to the full (often much
    // wider) browser window with no max-width cap, the mismatch was large
    // enough that only a thin horizontal sliver of the video was ever
    // visible. aspectRatio keeps the box's shape correct at any width.
    aspectRatio: 9 / 16,
    borderRadius: 14,
    backgroundColor: colors.ink,
    overflow: 'hidden',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 34,
    color: 'rgba(255,255,255,0.9)',
  },
  muteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteIcon: {
    fontSize: 12,
    color: colors.white,
  },
  chip: {
    marginHorizontal: 12,
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7E0',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  chipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    color: colors.goldText,
  },
  metaZone: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 4,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 17,
  },
  metaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timestamp: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.textMuted,
  },
  moreAffordance: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.textMuted,
  },
  actionRow: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  reportLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.error,
  },
  deleteLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.error,
  },
});
