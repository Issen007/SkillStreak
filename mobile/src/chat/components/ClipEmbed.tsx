import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { MessageClipEmbed } from '../../api/types';

interface ClipEmbedProps {
  clip: MessageClipEmbed;
  /** Only rendered when true — omitted entirely when the clip's uploader
   * is also the message's sender (per the flow doc: no redundant second
   * name shown). */
  showAttribution: boolean;
  /** Whether the attribution line opens CH4 (block) — judgment call: kept
   * non-interactive (plain text, not a `Pressable`) when the clip's
   * uploader is the *viewer themselves* (a teammate can attach the
   * viewer's own clip to their message), matching this app's existing
   * "never offer to block/report yourself" convention elsewhere
   * (`ClipCard.onTapAvatar`, `MessageBubble.onTapSender`) — the flow doc
   * doesn't explicitly call this case out, but the same rule clearly
   * applies. */
  attributionTappable: boolean;
  /** Recommended-not-required "only one clip plays at a time" (flow doc) —
   * `ChatScreen` owns a single "currently playing message id" and passes
   * whether *this* embed is the one. */
  isActive: boolean;
  onActivate: () => void;
  onTapAttribution: () => void;
}

/** CH1's in-message clip embed — identical playback philosophy to V2's
 * feed (`ClipCard`): static first frame, muted, tap to play/pause, no
 * autoplay (this addendum's own judgment call 22). Capped to a shorter
 * max-height than V2's own full-width card (~240dp, frontend-developer's
 * call within the doc's 220-260dp range) — this is one bubble in a
 * scrolling conversation, not a dedicated feed. */
export function ClipEmbed({
  clip,
  showAttribution,
  attributionTappable,
  isActive,
  onActivate,
  onTapAttribution,
}: ClipEmbedProps) {
  const { t } = useTranslation('chat');
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

  // "Only one embedded clip plays at a time across the visible chat" —
  // this embed auto-pauses itself the moment some *other* message's embed
  // becomes the active one.
  useEffect(() => {
    if (!isActive) player.pause();
  }, [isActive, player]);

  const handleTapVideo = () => {
    if (isPlaying) {
      player.pause();
    } else {
      onActivate();
      player.play();
    }
  };

  return (
    <View style={styles.wrapper}>
      <Pressable onPress={handleTapVideo} accessibilityRole="button" style={styles.videoArea}>
        <VideoView player={player} style={styles.video} nativeControls={false} contentFit="cover" />
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

      {clip.caption ? <Text style={styles.caption}>{clip.caption}</Text> : null}

      {showAttribution ? (
        attributionTappable ? (
          <Pressable onPress={onTapAttribution} accessibilityRole="button">
            <Text style={styles.attribution}>
              {t('clipEmbed.attribution', { screenName: clip.uploaderScreenName })}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.attributionStatic}>
            {t('clipEmbed.attribution', { screenName: clip.uploaderScreenName })}
          </Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 4,
  },
  videoArea: {
    height: 240,
    aspectRatio: 9 / 16,
    borderRadius: 12,
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
    fontSize: 28,
    color: 'rgba(255,255,255,0.9)',
  },
  muteButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteIcon: {
    fontSize: 10.5,
    color: colors.white,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 15,
  },
  attribution: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  // Non-tappable variant (uploader === viewer) — same weight/size, no
  // underline, so it doesn't visually promise a tap that does nothing.
  attributionStatic: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.textMuted,
  },
});
