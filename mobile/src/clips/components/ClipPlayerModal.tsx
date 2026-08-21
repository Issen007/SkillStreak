import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/Avatar';
import { formatClipRelativeTime } from '../../utils/formatDate';
import { ClipActionsSheet } from './ClipActionsSheet';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import { BLANK_PLAYBACK_TIMEOUT_MS, CLIP_ASPECT_RATIO } from '../constants';
import type { ClipFeedItem } from '../../api/types';

interface ClipPlayerModalProps {
  /** `null` = closed, same convention `reportTarget`/`deleteTarget`/
   * `blockTarget` already use in `ClipsScreen`. */
  clip: ClipFeedItem | null;
  isOwn: boolean;
  /** Tap-to-reveal state for the report/delete row — same single
   * `revealedClipId` `ClipsScreen` already owns, just compared against
   * this modal's clip instead of a card's. */
  revealed: boolean;
  onTapAvatar?: () => void;
  onTapMeta: () => void;
  onTapReport?: () => void;
  onTapDelete?: () => void;
  /** ADR-0030. Absent means the rollout has not reached this team, and no
   * share affordance is drawn at all — a disabled one would invite a child
   * to keep tapping something nothing they can do will unlock. */
  onTapShare?: () => void;
  /** ADR-0030. The player's own parental sharing permission, or null while
   * the status request is still in flight. Threaded straight through to
   * the actions sheet, which decides what it greys out. */
  sharingConsent?: 'none' | 'pending' | 'active' | null;
  /** ADR-0030. Absent when there is nothing useful to ask for. */
  onTapAskParent?: () => void;
  onClose: () => void;
}

/** Screen V2 (revised)'s tap-to-open full-screen player
 * (docs/design/clip-library-grid.md §2) — not a reuse of `ClipCard` (its
 * white-card chrome doesn't apply full-screen on a dark background), but
 * reuses the exact same `aspectRatio` video treatment and the same
 * handler props `ClipsScreen` already threads through today, just
 * re-targeted at whichever clip is `activeClip`.
 *
 * `Modal`'s `visible` prop doesn't stop React from rendering its children
 * — only `<ClipPlayerModalContent>`, rendered solely while `clip` is
 * non-null, actually calls `useVideoPlayer`, so there's never a moment
 * where that hook runs against a `null` source. */
export function ClipPlayerModal({ clip, onClose, ...rest }: ClipPlayerModalProps) {
  return (
    <Modal visible={clip !== null} transparent={false} animationType="fade" onRequestClose={onClose}>
      {clip ? <ClipPlayerModalContent clip={clip} onClose={onClose} {...rest} /> : null}
    </Modal>
  );
}

interface ClipPlayerModalContentProps extends Omit<ClipPlayerModalProps, 'clip'> {
  clip: ClipFeedItem;
}

function ClipPlayerModalContent({
  clip,
  isOwn,
  revealed,
  onTapAvatar,
  onTapMeta,
  onTapReport,
  onTapDelete,
  onTapShare,
  sharingConsent = null,
  onTapAskParent,
  onClose,
}: ClipPlayerModalContentProps) {
  const { t } = useTranslation('clips');
  const { width: windowWidth } = useWindowDimensions();

  // Muted by default, per the app-wide rule — same speaker-icon toggle as
  // everywhere else. `isPlaying`/`playerStatus` mirror `ClipCard`'s own
  // local pattern, plus a status track this modal is the first clip-video
  // surface to need (loading spinner + inline retryable error state).
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const player = useVideoPlayer(clip.playbackUrl, (p) => {
    p.loop = false;
    p.muted = true;
    // §2: "Opening -> autoplay, muted" — the one place in this app's clip
    // surfaces that autoplays, since tapping a thumbnail is already an
    // explicit "play this" gesture, unlike passively scrolling past a feed
    // card or grid cell.
    p.play();
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Whether this player has EVER actually played a frame, as opposed to
  // having merely reported a status. See the watchdog below.
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    const playingSub = player.addListener('playingChange', (payload: { isPlaying: boolean }) => {
      if (payload.isPlaying) hasPlayedRef.current = true;
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

  /**
   * Blank-panel watchdog — project owner's screenshot, 2026-08-09
   * (BACKLOG.md). The status machine above is sound on its own: it opens
   * on `loading` (spinner) and has a real `error` branch with retry. What
   * it cannot catch is a player that reports `readyToPlay` and then
   * renders nothing — which is exactly what the web build did after an
   * upload, leaving a full-screen navy rectangle with no spinner, no
   * error, and no way out. A status claim is not evidence; a frame is.
   *
   * So: if nothing has actually played within the grace period and the
   * player hasn't already errored, fall into the existing error state.
   * That state's Retry doubles as a tap-to-play, which also covers the
   * one benign case this could otherwise misread — a browser refusing
   * autoplay (unlikely here, since the player is muted, but the recovery
   * is identical either way).
   *
   * Deliberately generous at 8s: a cold MinIO fetch on a slow phone
   * connection is legitimately slow, and a false "couldn't play" is worse
   * than a few extra seconds of spinner.
   */
  useEffect(() => {
    if (playerStatus === 'error' || hasPlayedRef.current) return;
    const timer = setTimeout(() => {
      if (hasPlayedRef.current) return;
      // Logged, not swallowed: the backlog entry could not tell whether
      // this was a pending transcode, a dead presigned URL, or expo-video
      // simply not rendering on web, and this line is what makes the next
      // real occurrence answerable from the console.
      console.warn(
        `[clips] Playback produced no frames within ${BLANK_PLAYBACK_TIMEOUT_MS}ms (status=${playerStatus}) — showing the retry state instead of a blank panel.`,
      );
      setPlayerStatus('error');
    }, BLANK_PLAYBACK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [playerStatus]);

  const handleTapVideo = () => {
    if (playerStatus === 'error') return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  const handleRetry = () => {
    hasPlayedRef.current = false;
    setPlayerStatus('loading');
    player.replace(clip.playbackUrl);
    player.play();
  };

  // §2's web-specific judgment call: RN Web's `Modal` portals its content
  // outside `AppRoot`'s 480px-capped column, so that cap has to be
  // reapplied explicitly here rather than inherited — the dark backdrop is
  // fine filling the full (possibly much wider) browser viewport, but this
  // body wrapper (video + meta block) stays capped and centered, matching
  // the rest of the app's visual column on desktop. Native never had this
  // portal quirk (nothing else on native caps width — see this app's only
  // other use of this pattern, `AppRoot.tsx`'s identical `Platform.OS`
  // guard), so this must be a no-op there rather than an accidental cap on
  // a wide tablet.
  const bodyMaxWidth = Platform.OS === 'web' ? Math.min(480, windowWidth) : undefined;

  return (
    <View style={styles.container}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('clipPlayerModal.close')}
      />

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('clipPlayerModal.close')}
        hitSlop={8}
        style={styles.closeButton}
      >
        <Text style={styles.closeIcon}>✕</Text>
      </Pressable>

      <View style={[styles.body, { maxWidth: bodyMaxWidth }]} pointerEvents="box-none">
        <View style={styles.videoWrap} pointerEvents="auto">
          {playerStatus === 'error' ? (
            <View style={styles.errorState}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>{t('clipPlayerModal.playError')}</Text>
              <Pressable onPress={handleRetry} accessibilityRole="button" style={styles.retryButton}>
                <Text style={styles.retryText}>{t('v2.retry')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={handleTapVideo} accessibilityRole="button" style={styles.videoPressable}>
              <VideoView player={player} style={styles.video} nativeControls={false} contentFit="cover" />
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

        <ScrollView
          style={styles.metaScroll}
          contentContainerStyle={styles.metaScrollContent}
          pointerEvents="auto"
          showsVerticalScrollIndicator={false}
        >
          {onTapAvatar ? (
            <Pressable onPress={onTapAvatar} accessibilityRole="button" style={styles.headerRow}>
              <View style={styles.avatarCircle}>
                <Avatar avatarId={clip.uploaderAvatarId} size={19} />
              </View>
              <Text style={styles.name}>{clip.uploaderScreenName}</Text>
            </Pressable>
          ) : (
            <View style={styles.headerRow}>
              <View style={styles.avatarCircle}>
                <Avatar avatarId={clip.uploaderAvatarId} size={19} />
              </View>
              <Text style={styles.name}>{clip.uploaderScreenName}</Text>
            </View>
          )}

          {clip.taggedPlayerId && clip.taggedScreenName ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>
                {t('clipCard.challengeChip', { screenName: clip.taggedScreenName })}
              </Text>
            </View>
          ) : null}

          <View style={styles.metaZone}>
            {clip.caption ? <Text style={styles.caption}>{clip.caption}</Text> : null}
            <View style={styles.metaFooter}>
              <Text style={styles.timestamp}>{formatClipRelativeTime(clip.createdAt)}</Text>
              {/* The actions button.
                  Was 15px of 60%-opacity text inside a Pressable that
                  spanned the whole meta row — so the tap target was
                  technically large and visually invisible, and the project
                  owner reported it as "very difficult to hit". Now a real
                  44pt circular button, which is Apple's own minimum and
                  generous for a child's thumb, with a white fill so it
                  reads as a button against the video rather than as
                  decoration. `hitSlop` adds another 8pt on every side. */}
              <Pressable
                onPress={onTapMeta}
                accessibilityRole="button"
                accessibilityLabel={t('clipActions.a11yOpen')}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.moreButton,
                  pressed ? styles.moreButtonPressed : null,
                ]}
              >
                <Text style={styles.moreGlyph}>⋯</Text>
              </Pressable>
            </View>
          </View>

          <ClipActionsSheet
            visible={revealed}
            isOwn={isOwn}
            publishedPublicly={clip.publishedPublicly}
            consent={sharingConsent}
            onShare={onTapShare}
            onAskParent={onTapAskParent}
            onDelete={onTapDelete}
            onReport={onTapReport}
            onClose={onTapMeta}
          />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // The app's existing "night court" dark token (style-guide.md), not a
    // new near-black value.
    backgroundColor: colors.ink,
  },
  closeButton: {
    position: 'absolute',
    // This app has no `react-native-safe-area-context` dependency yet (its
    // only "environment" concession so far is `AppRoot.tsx`'s web-only
    // column cap) — a fixed offset, same posture as this screen's other
    // hardcoded top paddings (e.g. `ClipsScreen.content`'s
    // `paddingTop: 56`), rather than adding a new dependency for one
    // button's notch clearance.
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
  // Capped + centered per §2's web judgment call, and holds both the video
  // (fixed, non-scrolling) and the meta `ScrollView` below it, so a long
  // caption scrolls independently without ever moving the video itself.
  body: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 96,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  videoWrap: {
    width: '100%',
    aspectRatio: CLIP_ASPECT_RATIO,
    // Lets Yoga shrink (and, via `aspectRatio`, letterbox) the video box
    // when the full-width height would overflow the remaining space below
    // — the binding constraint on a short/landscape viewport is height,
    // not width, same "letterboxed on whichever dimension is binding"
    // rule §2 calls for.
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
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.white,
    textDecorationLine: 'underline',
  },
  // `flex: 1` — absorbs whatever vertical space is left in `body` after
  // the video above it, and scrolls its own content within that bounded
  // height rather than pushing the video (which is pinned to its natural
  // aspect-ratio size, only shrinking under `videoWrap.flexShrink` if
  // there's truly not enough room) off-screen.
  metaScroll: {
    flex: 1,
    // A guaranteed floor so the meta block (avatar/name row at minimum)
    // never gets squeezed to an unusable sliver by a tall 9:16 video at
    // full column width — on most phone-height viewports a 9:16 video at
    // full width is already nearly screen-tall, so without this the
    // avatar/caption/report row would be pushed almost entirely
    // off-screen instead of staying reachable-with-a-small-scroll.
    minHeight: 110,
    marginTop: 16,
  },
  metaScrollContent: {
    gap: 4,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 15,
  },
  name: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.white,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,184,0,0.18)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.gold,
  },
  metaZone: {
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.white,
    lineHeight: 18,
  },
  metaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timestamp: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    // A hairline edge so the circle still reads as a control on a pale
    // frame of video, where a white fill alone would disappear.
    borderWidth: 1,
    borderColor: 'rgba(27,27,58,0.14)',
  },
  moreButtonPressed: {
    backgroundColor: colors.border,
  },
  moreGlyph: {
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    lineHeight: 24,
    color: colors.ink,
  },
});
