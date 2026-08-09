import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { completeClipUpload } from '../../api/endpoints';
import { ApiError, isConsentRequiredError } from '../../api/ApiError';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { ClipUploadSession, ClipUploadState } from './clipUploadSession';

interface V6UploadProgressProps {
  teamId: string;
  /** The transfer started back at V4. Null only in the defensive case
   * where the flow was somehow entered without one. */
  session: ClipUploadSession | null;
  caption: string | undefined;
  taggedPlayerId: string | undefined;
  onSuccess: () => void;
  /** Called when `complete` rejects the caption — the only screen that can
   * fix it is V5, and the player's text has to survive the trip. */
  onEditCaption: (reason: string) => void;
  onConsentRevoked: () => void;
  onCancel: () => void;
}

/**
 * Screen V6 — the finishing step.
 *
 * **No longer owns the upload.** The bytes have been moving since V4 (see
 * ClipUploadSession), so on a normal upload this screen appears with the
 * transfer already finished and only has to call `complete` — which is the
 * entire point of the change: the child stops waiting for something that
 * could have happened while they typed.
 *
 * It still renders a progress bar, because "already finished" is the
 * common case and not a guarantee — a long clip on a slow connection can
 * still be mid-flight here, and that is precisely when a progress bar is
 * worth showing.
 *
 * `complete` is where the caption and tag are sent, so it is also where
 * their errors surface. Both route the player back to V5 with what they
 * wrote intact rather than dead-ending on this screen.
 */
export function V6UploadProgress({
  teamId,
  session,
  caption,
  taggedPlayerId,
  onSuccess,
  onEditCaption,
  onConsentRevoked,
  onCancel,
}: V6UploadProgressProps) {
  const { t } = useTranslation('clips');
  const [uploadState, setUploadState] = useState<ClipUploadState>(
    session?.getState() ?? { kind: 'failed', retryable: false },
  );
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!session) return undefined;
    setUploadState(session.getState());
    return session.subscribe(setUploadState);
  }, [session]);

  const finish = useCallback(
    async (clipId: string) => {
      setCompleting(true);
      setError(null);
      try {
        await completeClipUpload(teamId, clipId, { caption, taggedPlayerId });
        onSuccess();
      } catch (err) {
        if (isConsentRequiredError(err)) {
          onConsentRevoked();
          return;
        }
        if (err instanceof ApiError && err.code === 'caption_rejected_by_filter') {
          // The caption is only checked at complete now, so this is the
          // first moment it can be rejected. Send the player back to the
          // screen that can fix it, with their text intact — the transfer
          // keeps its place, so this costs them nothing but the edit.
          onEditCaption(t('v6.captionRejected'));
          return;
        } else if (err instanceof ApiError && err.code === 'clip_not_found') {
          // The pending clip is gone: swept by the abandoned-upload job
          // (its TTL runs from file-pick now, so a long captioning session
          // can genuinely outlive it) or deleted elsewhere. The bytes are
          // unrecoverable, so say so plainly rather than offering a retry
          // that cannot work.
          setError(t('v6.uploadExpired'));
        } else {
          setError(t('v6.giveUp'));
        }
      } finally {
        setCompleting(false);
      }
    },
    [teamId, caption, taggedPlayerId, onSuccess, onEditCaption, onConsentRevoked, t],
  );

  // Fires as soon as the transfer reports done — usually immediately on
  // mount, since it has been running since V4.
  useEffect(() => {
    if (uploadState.kind === 'uploaded' && !completing && !error) {
      void finish(uploadState.upload.clipId);
    }
    if (uploadState.kind === 'consent-revoked') {
      onConsentRevoked();
    }
    // `completing`/`error` are guards, not triggers — including them would
    // re-fire this the moment either clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadState]);

  const handleCancel = async () => {
    setCancelling(true);
    await session?.cancel();
    onCancel();
  };

  const failed = uploadState.kind === 'failed';
  const progress =
    uploadState.kind === 'uploading' ? uploadState.progress : 1;
  const message = error ?? (failed ? t('v6.giveUp') : null);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        {completing ? t('v6.finishingHeading') : t('v6.heading')}
      </Text>
      <Text style={styles.sub}>{t('v6.sub')}</Text>

      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]}
        />
      </View>

      {message ? (
        <>
          <Text style={styles.errorText}>{message}</Text>
          {failed ? (
            <SecondaryButton
              label={t('v6.retry')}
              onPress={() => session?.retry()}
            />
          ) : null}
        </>
      ) : null}

      <SecondaryButton
        label={t('v6.cancel')}
        loading={cancelling}
        onPress={() => void handleCancel()}
      />
      {message ? <SecondaryLink label={t('v6.backToFeed')} onPress={onCancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: 24,
    paddingTop: 100,
    gap: 16,
    alignItems: 'center',
  },
  heading: {
    fontFamily: fonts.headingBold,
    fontSize: 19,
    color: colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textBody,
    textAlign: 'center',
  },
  barTrack: {
    width: '100%',
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.flame,
    borderRadius: 6,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
});
