import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

interface PausedClipThumbnailProps {
  playbackUrl: string;
  style?: StyleProp<ViewStyle>;
}

/** ADR-0017 Part E — "no separate thumbnail asset exists or is generated,"
 * reused identically by CH6's picker grid and CH1's compose-bar chip: a
 * `<Video>` element that's never told to `.play()`, so it simply renders
 * paused at its first frame, muted. The exact same technique `ClipCard`
 * already relies on implicitly for V2's own cards (see that component's
 * comment) — pulled out here as its own tiny component since two more call
 * sites need the identical "just show frame 0" behavior, with no play/pause
 * affordance of their own (CH6's cards select-on-tap, the chip has no
 * playback control at all). */
export function PausedClipThumbnail({ playbackUrl, style }: PausedClipThumbnailProps) {
  const player = useVideoPlayer(playbackUrl, (p) => {
    p.loop = false;
    p.muted = true;
  });

  return <VideoView player={player} style={style} nativeControls={false} contentFit="cover" />;
}
