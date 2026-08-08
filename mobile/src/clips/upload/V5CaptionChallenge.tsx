import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { createClipUploadUrl, getTeammates } from '../../api/endpoints';
import { ApiError, isConsentRequiredError } from '../../api/ApiError';
import { AVATAR_CATALOG } from '../../onboarding/avatarCatalog';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { CreateClipUploadUrlResponse } from '../../api/types';
import type { TeammateEntry } from '../../api/types';
import type { PickedClip } from './PickedClip';

const CAPTION_MAX_LENGTH = 140;

interface V5CaptionChallengeProps {
  teamId: string;
  viewerPlayerId: string;
  clip: PickedClip;
  onSubmitted: (
    response: CreateClipUploadUrlResponse,
    caption: string | undefined,
    taggedPlayerId: string | undefined,
  ) => void;
  onConsentRevoked: () => void;
  onCancel: () => void;
}

/** Screen V5 — "Bildtext & utmana en lagkompis (frivilligt)." Submitting
 * calls endpoint 1 (`upload-url`); the actual `PUT`/`complete` sequence
 * happens on the next screen (V6), never here. */
export function V5CaptionChallenge({
  teamId,
  viewerPlayerId,
  clip,
  onSubmitted,
  onConsentRevoked,
  onCancel,
}: V5CaptionChallengeProps) {
  const { t } = useTranslation('clips');
  const [caption, setCaption] = useState('');
  const [teammates, setTeammates] = useState<TeammateEntry[] | null>(null);
  const [taggedPlayerId, setTaggedPlayerId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
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
      const response = await createClipUploadUrl(teamId, {
        mimeType: clip.mimeType,
        fileSizeBytes: clip.fileSizeBytes,
        durationSeconds: clip.durationSeconds,
        caption: trimmedCaption.length > 0 ? trimmedCaption : undefined,
        taggedPlayerId: taggedPlayerId ?? undefined,
      });
      onSubmitted(
        response,
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
      {teammates === null ? (
        <ActivityIndicator color={colors.flame} />
      ) : teammates.length === 0 ? (
        <Text style={styles.helperText}>{t('v5.noTeammates')}</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {teammates.map((teammate) => {
            const emoji = AVATAR_CATALOG.find((a) => a.avatarId === teammate.avatarId)?.emoji ?? '🙂';
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
                  <Text style={styles.chipEmoji}>{emoji}</Text>
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
