import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { CLIP_ASPECT_RATIO } from '../../clips/constants';
import type { PendingChallengeEntry } from '../../api/types';

interface ChallengeClipModalProps {
  /** `null` = closed, same convention as every other `xTarget: T | null`
   * modal in this codebase. */
  challenge: PendingChallengeEntry | null;
  onClose: () => void;
}

/** Fas 4.6 — the full-screen player behind a `ChallengeRow`'s "Titta →"
 * (docs/design/clip-challenge-notifications-ui.md §5). A deliberately
 * smaller sibling of `clips/components/ClipPlayerModal.tsx`, not a reuse:
 * that one is typed against `ClipFeedItem` (`taggedPlayerId`,
 * `taggedScreenName`, `reportedByMe`, ...), fields the pending-challenges
 * response doesn't carry at all.
 *
 * **Deliberately omits report/delete.** Delete never applies (the viewer
 * here is always the *tagged* player, never the uploader). Report is left
 * out because this response has no `reportedByMe` field, so this surface
 * couldn't show that state honestly — and the identical clip is always
 * reachable *with* full report support from both the Shorts feed and the
 * chat system message's own `ClipEmbed`, so this isn't a gap in the
 * child-safety flow, just one fewer path into it.
 *
 * `Modal`'s `visible` prop doesn't stop React from rendering its children —
 * only `<ChallengeClipModalContent>`, rendered solely while `challenge` is
 * non-null, calls `useVideoPlayer`, so that hook never runs against a
 * `null` source (same structure as `ClipPlayerModal`). */
export function ChallengeClipModal({ challenge, onClose }: ChallengeClipModalProps) {
  return (
    <Modal
      visible={challenge !== null}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
    >
      {challenge ? <ChallengeClipModalContent challenge={challenge} onClose={onClose} /> : null}
    </Modal>
  );
}

interface ChallengeClipModalContentProps {
  challenge: PendingChallengeEntry;
  onClose: () => void;
}

function ChallengeClipModalContent({ challenge, onClose }: ChallengeClipModalContentProps) {
  const { t } = useTranslation('team');
  const { width: windowWidth } = useWindowDimensions();

  // Muted by default, per the app-wide rule — same speaker-icon toggle as
  // every other clip surface.
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const player = useVideoPlayer(challenge.playbackUrl, (p) => {
    p.loop = false;
    p.muted = true;
    // Autoplay, muted — tapping "Titta →" is already an explicit "play
    // this" gesture, same call `ClipPlayerModal` makes for its own
    // tap-a-thumbnail entry point.
    p.play();
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    const playingSub = player.addListener('playingChange', (payload: { isPlaying: boolean }) => {
      setIsPlaying(payload.isPlaying);
    });
    const statusSub = player.addListener(
      'statusChange',
      (payload: { status: 'idle' | 'loading' | 'readyToPlay' | 'error' }) => {
        if (payload.status === 'readyToPlay') setPlayerStatus('ready');
        else if (payload.status === 'error') setPlayerStatus('error');
        else setPlayerStatus('loading');
      },
    );
    return () => {
      playingSub.remove();
      statusSub.remove();
    };
  }, [player]);

  const handleTapVideo = () => {
    if (playerStatus === 'error') return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  // RN Web portals `Modal` content outside `AppRoot`'s 480px-capped column,
  // so the cap has to be reapplied here rather than inherited — a no-op on
  // native, identical guard to `ClipPlayerModal`'s.
  const bodyMaxWidth = Platform.OS === 'web' ? Math.min(480, windowWidth) : undefined;

  return (
    <View style={styles.container}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('challengeClipModal.close')}
      />

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('challengeClipModal.close')}
        hitSlop={8}
        style={styles.closeButton}
      >
        <Text style={styles.closeIcon}>✕</Text>
      </Pressable>

      <View style={[styles.body, { maxWidth: bodyMaxWidth }]} pointerEvents="box-none">
        <Text style={styles.heading}>
          {t('challengeClipModal.heading', { screenName: challenge.uploaderScreenName })}
        </Text>

        <View style={styles.videoWrap} pointerEvents="auto">
          {playerStatus === 'error' ? (
            <View style={styles.errorState}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>{t('challengeClipModal.playError')}</Text>
            </View>
          ) : (
            <Pressable
              onPress={handleTapVideo}
              accessibilityRole="button"
              style={styles.videoPressable}
            >
              <VideoView
                player={player}
                style={styles.video}
                nativeControls={false}
                contentFit="cover"
              />
              {playerStatus === 'loading' ? (
                <View pointerEvents="none" style={styles.loadingOverlay}>
                  <ActivityIndicator color={colors.white} size="large" />
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
          )}
        </View>

        {challenge.caption ? (
          <Text style={styles.caption} numberOfLines={2}>
            {challenge.caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  closeButton: {
    position: 'absolute',
    // Fixed offset — this app has no safe-area dependency, same posture as
    // `ClipPlayerModal`'s identical button.
    top: 48,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  closeIcon: {
    fontSize: 18,
    color: colors.white,
  },
  body: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 96,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 17,
    color: colors.white,
  },
  videoWrap: {
    width: '100%',
    aspectRatio: CLIP_ASPECT_RATIO,
    // Lets Yoga letterbox the video box when a full-width height would
    // overflow the remaining space, same rule as `ClipPlayerModal`.
    flexShrink: 1,
  },
  videoPressable: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.ink,
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteIcon: {
    fontSize: 13,
    color: colors.white,
  },
  errorState: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  errorIcon: {
    fontSize: 26,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.white,
    textAlign: 'center',
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.white,
    lineHeight: 18,
  },
});
