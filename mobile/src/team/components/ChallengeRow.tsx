import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PausedClipThumbnail } from '../../chat/components/PausedClipThumbnail';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';

interface ChallengeRowProps {
  uploaderScreenName: string;
  caption: string | null;
  /** Passed straight to `PausedClipThumbnail` — the same presigned playback
   * URL the modal will use, no separate thumbnail asset (ADR-0017 Part E). */
  playbackUrl: string;
  /** True while *this* row's own ack call is in flight (the "Redan sett"
   * trigger only — the "Titta" trigger never blocks on its ack). */
  acking: boolean;
  onWatch: () => void;
  onDismiss: () => void;
}

/** Fas 4.6 — one row in Laget's "Utmaningar till dig" section
 * (docs/design/clip-challenge-notifications-ui.md §1.2). Modeled on
 * `PendingJoinRow`'s layout, with the avatar circle swapped for a small
 * static clip thumbnail (`PausedClipThumbnail`, reused verbatim).
 *
 * **Two physically separate tap zones**, the same rule `ClipCard` and
 * `MessageBubble` already follow: zone 1 is the whole row except the
 * dismiss link (tap anywhere → watch), zone 2 is the small, de-emphasized
 * "Redan sett" escape hatch. Watching and dismissing must never be one
 * accidental mis-tap apart. */
export function ChallengeRow({
  uploaderScreenName,
  caption,
  playbackUrl,
  acking,
  onWatch,
  onDismiss,
}: ChallengeRowProps) {
  const { t } = useTranslation('team');

  return (
    <View style={styles.row}>
      {/* Zone 1 — the large, obvious, default target. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('challengeRow.a11yLabel', { screenName: uploaderScreenName })}
        onPress={onWatch}
        style={({ pressed }) => [styles.watchZone, pressed && styles.pressed]}
      >
        <View style={styles.thumbnailWrap}>
          <PausedClipThumbnail playbackUrl={playbackUrl} style={styles.thumbnail} />
        </View>

        <View style={styles.textColumn}>
          <Text style={styles.title}>
            {t('challengeRow.title', { screenName: uploaderScreenName })}
          </Text>
          {caption ? (
            <Text style={styles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
          <Text style={styles.watchCta}>{t('challengeRow.watchCta')}</Text>
        </View>
      </Pressable>

      {/* Zone 2 — its own small, separate Pressable with its own hitSlop,
          outside zone 1's bounds entirely so a near-miss on "Titta →"
          can never land here. */}
      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        disabled={acking}
        hitSlop={8}
        style={({ pressed }) => [styles.dismissZone, (pressed || acking) && styles.pressed]}
      >
        <Text style={styles.dismissText}>{acking ? '…' : t('challengeRow.dismissCta')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  watchZone: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pressed: {
    opacity: 0.6,
  },
  // 44x62 — the same 9:16 portrait shape as `ClipGridCell`, on the same
  // `ink` backing so a still-loading frame reads as "video", not a gap.
  thumbnailWrap: {
    width: 44,
    height: 62,
    borderRadius: 8,
    backgroundColor: colors.ink,
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  // `flame`, not `gold` — a single clip challenge between two players is a
  // personal ("mine") event, not a team-pool one (style-guide.md's motif
  // split). `flameText` rather than `flame` itself, per the contrast rule:
  // flame is a fill color, never text on white.
  watchCta: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.flameText,
    marginTop: 2,
  },
  dismissZone: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  dismissText: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
});
