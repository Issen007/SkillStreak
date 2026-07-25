import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { SecondaryButton } from '../../components/SecondaryButton';
import { SecondaryLink } from '../../components/SecondaryLink';
import { completeClipUpload, createClipUploadUrl, deleteClip } from '../../api/endpoints';
import { ApiError, isConsentRequiredError } from '../../api/ApiError';
import { colors } from '../../theme/colors';
import { fonts } from '../../theme/fonts';
import type { CompleteClipUploadResponse, CreateClipUploadUrlResponse } from '../../api/types';
import type { PickedClip } from './PickedClip';

const RETRY_FAILURE_MESSAGE = 'Något gick fel med uppladdningen. Vi provar igen från början.';
const GIVE_UP_MESSAGE =
  'Uppladdningen lyckades inte den här gången. Kolla din uppkoppling och testa igen.';
// One silent automatic retry-from-scratch (per the flow doc's V6 note) —
// capped rather than looped forever, so a persistently bad connection
// surfaces a manual retry instead of silently burning through the upload
// rate limit.
const MAX_AUTOMATIC_ATTEMPTS = 2;

interface V6UploadProgressProps {
  teamId: string;
  clip: PickedClip;
  caption: string | undefined;
  taggedPlayerId: string | undefined;
  initialUpload: CreateClipUploadUrlResponse;
  onSuccess: (response: CompleteClipUploadResponse) => void;
  onConsentRevoked: () => void;
  onCancel: () => void;
}

/** Screen V6 — "Laddar upp klippet…" The required two-phase sequence:
 * `PUT` the raw bytes to `uploadUrl` directly (never through this app's own
 * API), then call `complete`. Never skip the second call, even though the
 * `PUT` alone can appear to succeed — `published`/`expiresAt` are only ever
 * set by `complete` (per the contract's explicit note, and this project's
 * own history of code-critic catching "skip step 2" bugs in similar
 * flows). */
export function V6UploadProgress({
  teamId,
  clip,
  caption,
  taggedPlayerId,
  initialUpload,
  onSuccess,
  onConsentRevoked,
  onCancel,
}: V6UploadProgressProps) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'uploading' | 'completing'>('uploading');
  const [manualError, setManualError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const currentUploadRef = useRef(initialUpload);
  const attemptRef = useRef(1);
  const uploadTaskRef = useRef<FileSystem.UploadTask | null>(null);
  const cancelledRef = useRef(false);
  const runIdRef = useRef(0);

  const runAttempt = useCallback(
    async (upload: CreateClipUploadUrlResponse) => {
      const runId = ++runIdRef.current;
      currentUploadRef.current = upload;
      setPhase('uploading');
      setProgress(0);
      setManualError(null);

      try {
        const task = FileSystem.createUploadTask(
          upload.uploadUrl,
          clip.uri,
          {
            httpMethod: 'PUT',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: upload.requiredHeaders,
          },
          (data) => {
            if (runId !== runIdRef.current) return;
            const total = data.totalBytesExpectedToSend;
            setProgress(total > 0 ? data.totalBytesSent / total : 0);
          },
        );
        uploadTaskRef.current = task;

        const result = await task.uploadAsync();
        if (cancelledRef.current || runId !== runIdRef.current) return;

        if (!result || result.status < 200 || result.status >= 300) {
          throw new Error(`Upload PUT failed with status ${result?.status ?? 'unknown'}`);
        }

        setPhase('completing');
        const response = await completeClipUpload(teamId, upload.clipId);
        if (cancelledRef.current || runId !== runIdRef.current) return;
        onSuccess(response);
      } catch (err) {
        if (cancelledRef.current || runId !== runIdRef.current) return;

        if (isConsentRequiredError(err)) {
          onConsentRevoked();
          return;
        }

        const isRetryableContractError =
          err instanceof ApiError &&
          (err.code === 'upload_not_found' || err.code === 'clip_processing_failed');

        if (attemptRef.current < MAX_AUTOMATIC_ATTEMPTS) {
          attemptRef.current += 1;
          try {
            const freshUpload = await createClipUploadUrl(teamId, {
              mimeType: clip.mimeType,
              fileSizeBytes: clip.fileSizeBytes,
              durationSeconds: clip.durationSeconds,
              caption,
              taggedPlayerId,
            });
            if (cancelledRef.current || runId !== runIdRef.current) return;
            void runAttempt(freshUpload);
            return;
          } catch (retryErr) {
            if (isConsentRequiredError(retryErr)) {
              onConsentRevoked();
              return;
            }
            // Fall through to the manual-error state below.
          }
        }

        setManualError(isRetryableContractError ? RETRY_FAILURE_MESSAGE : GIVE_UP_MESSAGE);
      }
    },
    [teamId, clip, caption, taggedPlayerId, onSuccess, onConsentRevoked],
  );

  useEffect(() => {
    void runAttempt(initialUpload);
    return () => {
      cancelledRef.current = true;
    };
    // Only ever run once per mount — retries are driven internally via
    // `runAttempt`'s own recursion, not by re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    setCancelling(true);
    cancelledRef.current = true;
    try {
      await uploadTaskRef.current?.cancelAsync();
    } catch {
      // Non-critical — the DELETE below (or, failing that, the pending_upload
      // TTL sweep) is the real cleanup regardless of whether the client-side
      // cancel itself succeeded.
    }
    try {
      // Judgment call (flagged for backend-developer, per the flow doc):
      // "Avbryt" deletes the still-pending_upload clip immediately rather
      // than waiting on the ~1 hour TTL sweep. Best-effort — if this fails,
      // the sweep still cleans it up eventually.
      await deleteClip(teamId, currentUploadRef.current.clipId);
    } catch {
      // Swallow — see above.
    } finally {
      onCancel();
    }
  };

  const handleManualRetry = () => {
    attemptRef.current = 1;
    void runAttempt(currentUploadRef.current);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Laddar upp klippet…</Text>
      <Text style={styles.sub}>Lämna inte appen — det tar bara en liten stund.</Text>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.round((phase === 'completing' ? 1 : progress) * 100)}%` },
          ]}
        />
      </View>

      {manualError ? (
        <>
          <Text style={styles.errorText}>{manualError}</Text>
          <SecondaryButton label="Försök igen" onPress={handleManualRetry} />
        </>
      ) : null}

      <SecondaryButton label="Avbryt" loading={cancelling} onPress={() => void handleCancel()} />
      {manualError ? <SecondaryLink label="Tillbaka till flödet" onPress={onCancel} /> : null}
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
