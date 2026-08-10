import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { getTeammates } from '../../api/endpoints';
import { ApiError, isConsentRequiredError } from '../../api/ApiError';
import { Avatar } from '../../components/Avatar';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { TeammateEntry } from '../../api/types';
import type { PickedClip } from './PickedClip';
import type { ClipUploadSession } from './clipUploadSession';

const CAPTION_MAX_LENGTH = 140;

interface V5CaptionChallengeProps {
  teamId: string;
  viewerPlayerId: string;
  clip: PickedClip;
  /** The transfer already running behind this screen, started at V4. Null
   * only in the defensive case where the flow was entered without one. */
  session: ClipUploadSession | null;
  /** Prefilled when returning here from V6 because `complete` rejected the
   * caption — a child should never have to retype what they wrote. */
  initialCaption?: string;
  initialTaggedPlayerId?: string;
  /** Set when V6 bounced back with a rejected caption, so the reason is
   * visible on the screen that can actually fix it. */
  initialCaptionError?: string | null;
  onSubmitted: (
    caption: string | undefined,
    taggedPlayerId: string | undefined,
  ) => void;
  onConsentRevoked: () => void;
  onCancel: () => void;
}

/** Screen V5 — "Bildtext & utmana en lagkompis (frivilligt)."
 *
 * **No longer mints the upload URL.** That happens at V4 now, so the bytes
 * are already moving while the player types here — the whole point of the
 * background-upload change. Submitting just hands the caption and tag to
 * V6, which sends them at `complete`.
 *
 * Consequence worth knowing: the two errors this screen used to catch from
 * `upload-url` (a rejected caption, a tagged player who is no longer
 * eligible) now come back from `complete` instead, on the next screen. The
 * caption is not validated until then, so V5 can no longer tell a player
 * their caption was rejected while they are still looking at it. That is a
 * real regression in feedback locality, accepted deliberately: it is the
 * price of not making them wait, and V6 routes both back here with the
 * caption preserved rather than dead-ending. */
export function V5CaptionChallenge({
  session,
  initialCaption,
  initialTaggedPlayerId,
  initialCaptionError,
  teamId,
  viewerPlayerId,
  clip,
  onSubmitted,
  onConsentRevoked,
  onCancel,
}: V5CaptionChallengeProps) {
  const { t } = useTranslation('clips');
  const [caption, setCaption] = useState(initialCaption ?? '');
  const [teammates, setTeammates] = useState<TeammateEntry[] | null>(null);
  const [taggedPlayerId, setTaggedPlayerId] = useState<string | null>(
    initialTaggedPlayerId ?? null,
  );

  const [submitting, setSubmitting] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(
    initialCaptionError ?? null,
  );
  // The transfer is running behind this screen, and it can fail while the
  // player is still typing. Saying so here — rather than letting them
  // finish a caption and only then meet an error — is the one thing this
  // screen needs the session for. Deliberately not a progress percentage:
  // the point of moving the upload here is that a child stops watching it.
  const [uploadFailed, setUploadFailed] = useState(
    session?.getState().kind === 'failed',
  );

  useEffect(() => {
    if (!session) return undefined;
    return session.subscribe((state) => setUploadFailed(state.kind === 'failed'));
  }, [session]);
  const [tagError, setTagError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const player = useVideoPlayer(clip.uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    // approvedOnly: the backend has supported this since 2026-08-06 but
    // nothing called it, so a teammate whose join is still PENDING was
    // offered as taggable here and then rejected at submit time with a
    // 400 — a real error for a choice the picker should never have shown.
    // Filtering server-side rather than here keeps the two in step.
    void getTeammates(teamId, { approvedOnly: true })
      .then((response) =>
        setTeammates(response.teammates.filter((t) => t.playerId !== viewerPlayerId)),
      )
      .catch(() => setTeammates([]));
  }, [teamId, viewerPlayerId]);

  const taggedTeammate = teammates?.find((t) => t.playerId === taggedPlayerId) ?? null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setCaptionError(null);
    setTagError(null);
    setFormError(null);
    try {
      const trimmedCaption = caption.trim();
      onSubmitted(
        trimmedCaption.length > 0 ? trimmedCaption : undefined,
        taggedPlayerId ?? undefined,
      );
    } catch (err) {
      if (isConsentRequiredError(err)) {
        onConsentRevoked();
        return;
      }
      if (err instanceof ApiError && err.code === 'caption_rejected_by_filter') {
        setCaptionError(t('v5.captionRejected'));
      } else if (err instanceof ApiError && err.code === 'clip_upload_rate_limited') {
        setFormError(t('v5.rateLimited'));
      } else if (
        err instanceof ApiError &&
        err.code === 'validation_error' &&
        err.message.toLowerCase().includes('taggedplayerid')
      ) {
        setTagError(t('v5.taggedPlayerGone'));
        setTaggedPlayerId(null);
      } else {
        setFormError(t('v5.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>{t('v5.heading')}</Text>

      <View style={styles.previewWrap}>
        <VideoView player={player} style={styles.preview} nativeControls={false} contentFit="cover" />
      </View>

      <TextInput
        value={caption}
        onChangeText={(text) => {
          setCaption(text.slice(0, CAPTION_MAX_LENGTH));
          if (captionError) setCaptionError(null);
        }}
        placeholder={t('v5.captionPlaceholder')}
        placeholderTextColor={colors.textMuted}
        multiline
        style={[styles.captionInput, captionError && styles.inputError]}
      />
      {caption.length > 100 ? (
        <Text style={styles.counter}>
          {caption.length}/{CAPTION_MAX_LENGTH}
        </Text>
      ) : null}
      {captionError ? <Text style={styles.errorText}>{captionError}</Text> : null}

      <Text style={styles.sectionLabel}>{t('v5.challengeLabel')}</Text>
      {uploadFailed ? <Text style={styles.uploadWarning}>{t('v5.uploadStalled')}</Text> : null}

      {teammates === null ? (
        <ActivityIndicator color={colors.flame} />
      ) : teammates.length === 0 ? (
        <Text style={styles.helperText}>{t('v5.noTeammates')}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {teammates.map((teammate) => {
            const selected = teammate.playerId === taggedPlayerId;
            return (
              <Pressable
                key={teammate.playerId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() =>
                  setTaggedPlayerId((prev) => (prev === teammate.playerId ? null : teammate.playerId))
                }
                style={styles.chip}
              >
                <View style={[styles.chipAvatar, selected && styles.chipAvatarSelected]}>
                  <Avatar avatarId={teammate.avatarId} size={24} />
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {teammate.screenName}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {tagError ? <Text style={styles.errorText}>{tagError}</Text> : null}
      {taggedTeammate ? (
        <Text style={styles.helperText}>
          {t('v5.taggedHelper', { screenName: taggedTeammate.screenName })}
        </Text>
      ) : null}

      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

      <PrimaryButton label={t('v5.upload')} loading={submitting} onPress={() => void handleSubmit()} />
      <SecondaryLink label={t('v5.cancel')} onPress={onCancel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  uploadWarning: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
    marginTop: 6,
  },
  container: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 20,
    color: colors.ink,
  },
  previewWrap: {
    // Same fix as ClipCard.videoArea — a fixed height (previously 200)
    // mismatches this recorded clip's real 9:16 portrait shape once the
    // container isn't a narrow phone width (e.g. on web with no max-width
    // cap), and contentFit="cover" then crops most of the frame away.
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  captionInput: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    minHeight: 56,
  },
  inputError: {
    borderColor: colors.error,
  },
  counter: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.error,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.ink,
    marginTop: 4,
  },
  helperText: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  chipRow: {
    gap: 10,
    paddingVertical: 2,
  },
  chip: {
    alignItems: 'center',
    gap: 4,
    width: 60,
  },
  chipAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.flameTint,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  chipAvatarSelected: {
    borderColor: colors.gold,
  },
  chipEmoji: {
    fontSize: 19,
  },
  chipName: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    color: colors.ink,
    textAlign: 'center',
  },
});
