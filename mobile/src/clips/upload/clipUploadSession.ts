import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { createClipUploadUrl, deleteClip } from '../../api/endpoints';
import { isConsentRequiredError } from '../../api/ApiError';
import type { CreateClipUploadUrlResponse } from '../../api/types';
import type { PickedClip } from './PickedClip';

/** One silent automatic retry-from-scratch, capped rather than looped
 * forever so a persistently bad connection surfaces a manual retry instead
 * of quietly burning the daily upload allowance. Unchanged from the
 * behaviour this was extracted from. */
const MAX_AUTOMATIC_ATTEMPTS = 2;

export type ClipUploadState =
  | { kind: 'uploading'; progress: number }
  | { kind: 'uploaded'; upload: CreateClipUploadUrlResponse }
  | { kind: 'consent-revoked' }
  /** `retryable` distinguishes "the connection was bad" from "give up" —
   * the screen shows a different message and a retry only for the former,
   * matching what V6 did before this was extracted. */
  | { kind: 'failed'; retryable: boolean };

/**
 * `expo-file-system`'s `createUploadTask`/`uploadAsync` has no web
 * implementation at all — the package's own `.web.ts` shim doesn't define
 * `uploadTaskStartAsync`, so calling it on web throws immediately, every
 * attempt, every retry. Confirmed live 2026-07-31 as the cause of every
 * "try it" site upload failing. Web instead does the same presigned `PUT`
 * via `XMLHttpRequest` (not `fetch`, which has no cross-browser
 * upload-progress event); `clip.uri` on web is a `blob:` URL from
 * expo-image-picker, fetched into a real `Blob` first since
 * `XMLHttpRequest.send` needs the bytes, not a reference to them.
 * Requires the bucket to allow this cross-origin PUT — a browser enforces
 * CORS here, unlike native's direct native-module HTTP call.
 */
async function putViaXhrForWeb(
  uploadUrl: string,
  headers: Record<string, string>,
  fileUri: string,
  onXhrReady: (xhr: XMLHttpRequest) => void,
  onProgress: (sentBytes: number, totalBytes: number) => void,
): Promise<{ status: number }> {
  const blob = await (await fetch(fileUri)).blob();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhrReady(xhr);
    xhr.open('PUT', uploadUrl);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => resolve({ status: xhr.status });
    xhr.onerror = () => reject(new Error('Network error during the upload PUT.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(blob);
  });
}

/**
 * A clip upload that runs independently of whichever screen is on top.
 *
 * **Why this exists as a plain object rather than living in a component**
 * (docs/internal/BACKLOG.md, from the project owner's screenshots): the
 * upload used to start only once the caption had been submitted, so a
 * child sat watching a progress bar with copy telling them not to leave
 * the app — at exactly the moment they might give up. Starting the
 * transfer the instant a file is picked hides most or all of that wait,
 * but it means the bytes have to keep moving across a screen change, which
 * a component that unmounts cannot do.
 *
 * The caption and tag are deliberately NOT part of this. They do not exist
 * when the transfer starts, so the URL is minted bare and both are sent at
 * `complete` instead — which is what the backend change on 2026-08-09
 * enabled, and why that change needed a security review of its own.
 *
 * **Not a React hook**: the session outlives the screen that started it,
 * and `UploadFlow` holds it across V5 → V6. Subscribers come and go.
 */
export class ClipUploadSession {
  private state: ClipUploadState = { kind: 'uploading', progress: 0 };
  private listeners = new Set<(state: ClipUploadState) => void>();
  private upload: CreateClipUploadUrlResponse | null = null;
  private attempt = 1;
  private cancelled = false;
  private xhr: XMLHttpRequest | null = null;
  private task: FileSystem.UploadTask | null = null;
  private runId = 0;

  constructor(
    private readonly teamId: string,
    private readonly clip: PickedClip,
  ) {}

  start(): void {
    void this.run();
  }

  getState(): ClipUploadState {
    return this.state;
  }

  /** The clip id, once minted — `null` while the first `upload-url` call is
   * still in flight. `UploadFlow` needs it to delete a cancelled upload. */
  getClipId(): string | null {
    return this.upload?.clipId ?? null;
  }

  subscribe(listener: (state: ClipUploadState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Manual retry from the failed state, resetting the automatic-attempt
   * budget the way V6's own "Försök igen" did. */
  retry(): void {
    if (this.cancelled) return;
    this.attempt = 1;
    void this.run();
  }

  /**
   * Aborts the transfer for real — not just visually. Under background
   * upload the child is looking at a caption box while bytes move, so
   * "Avbryt" is now much likelier to fire mid-transfer than it was when
   * the progress screen was the only place it existed; letting the request
   * quietly finish would upload a video they explicitly discarded.
   *
   * Best-effort deletion of the pending row follows, so a discarded clip
   * doesn't wait out the abandoned-upload sweep holding storage.
   */
  async cancel(): Promise<void> {
    this.cancelled = true;
    this.runId += 1;
    try {
      this.xhr?.abort();
      await this.task?.cancelAsync();
    } catch {
      // Non-critical: the delete below, or failing that the pending_upload
      // sweep, is the real cleanup either way.
    }
    const clipId = this.upload?.clipId;
    if (!clipId) return;
    try {
      await deleteClip(this.teamId, clipId);
    } catch {
      // Swallow — see above.
    }
  }

  private emit(state: ClipUploadState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }

  private async run(): Promise<void> {
    const runId = ++this.runId;
    this.xhr = null;
    this.task = null;
    this.emit({ kind: 'uploading', progress: 0 });

    try {
      // Minted bare: no caption, no tag. Re-minted on every attempt rather
      // than reused, because a presigned PUT URL is only valid for five
      // minutes and a retry can easily land past that — a stale URL fails
      // with a 403 from object storage that looks nothing like a network
      // error, which is exactly the confusing failure the old flow could
      // produce.
      const upload = await createClipUploadUrl(this.teamId, {
        mimeType: this.clip.mimeType,
        fileSizeBytes: this.clip.fileSizeBytes,
        durationSeconds: this.clip.durationSeconds,
      });
      if (this.isStale(runId)) return;
      this.upload = upload;

      const result = await this.put(upload, runId);
      if (this.isStale(runId)) return;

      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(`Upload PUT failed with status ${result?.status ?? 'unknown'}`);
      }

      this.emit({ kind: 'uploaded', upload });
    } catch (err) {
      if (this.isStale(runId)) return;

      if (isConsentRequiredError(err)) {
        this.emit({ kind: 'consent-revoked' });
        return;
      }

      if (this.attempt < MAX_AUTOMATIC_ATTEMPTS) {
        this.attempt += 1;
        void this.run();
        return;
      }

      this.emit({ kind: 'failed', retryable: true });
    }
  }

  private isStale(runId: number): boolean {
    return this.cancelled || runId !== this.runId;
  }

  private async put(
    upload: CreateClipUploadUrlResponse,
    runId: number,
  ): Promise<{ status: number } | null> {
    if (Platform.OS === 'web') {
      return putViaXhrForWeb(
        upload.uploadUrl,
        upload.requiredHeaders,
        this.clip.uri,
        (xhr) => {
          this.xhr = xhr;
        },
        (sent, total) => {
          if (this.isStale(runId)) return;
          this.emit({
            kind: 'uploading',
            progress: total > 0 ? sent / total : 0,
          });
        },
      );
    }

    const task = FileSystem.createUploadTask(
      upload.uploadUrl,
      this.clip.uri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: upload.requiredHeaders,
      },
      (data) => {
        if (this.isStale(runId)) return;
        const total = data.totalBytesExpectedToSend;
        this.emit({
          kind: 'uploading',
          progress: total > 0 ? data.totalBytesSent / total : 0,
        });
      },
    );
    this.task = task;
    const nativeResult = await task.uploadAsync();
    return nativeResult ? { status: nativeResult.status } : null;
  }
}
