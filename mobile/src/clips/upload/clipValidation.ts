import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';

import type { ClipMimeType } from '../../api/types';
import type { PickedClip } from './PickedClip';

// Mirrors backend/src/video-clips/video-clip.constants.ts exactly —
// checking the same caps client-side lets Screen V4 catch an obviously
// too-long/wrong-format file with an inline message rather than a
// round-trip 400 (per docs/design/phase3-flows.md's Screen V4 note).
export const ALLOWED_CLIP_MIME_TYPES: ClipMimeType[] = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
];
export const CLIP_MAX_FILE_SIZE_BYTES = 75_000_000;
export const CLIP_MAX_DURATION_SECONDS = 60;

const EXTENSION_MIME_MAP: Record<string, ClipMimeType> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
};

/** The picker's own `mimeType` field is inconsistent across platforms (and
 * sometimes absent) — fall back to the file extension, same allow-list the
 * backend enforces (`extensionForMimeType`). Returns `null` if neither
 * source resolves to one of the three allowed types. */
function resolveMimeType(asset: ImagePickerAsset): ClipMimeType | null {
  if (asset.mimeType) {
    const normalized = asset.mimeType.toLowerCase();
    if ((ALLOWED_CLIP_MIME_TYPES as string[]).includes(normalized)) {
      return normalized as ClipMimeType;
    }
    // Some platforms report a mimeType not literally in the allow-list even
    // for an otherwise-fine file (e.g. `video/mov` instead of
    // `video/quicktime`) — fall through to the extension check below rather
    // than rejecting on this alone.
  }
  const extensionMatch = /\.([a-z0-9]+)$/i.exec(asset.uri);
  const extension = extensionMatch?.[1]?.toLowerCase();
  return extension ? (EXTENSION_MIME_MAP[extension] ?? null) : null;
}

export type ClipValidationResult =
  | { ok: true; clip: PickedClip }
  | { ok: false; reason: 'too_long' | 'wrong_format' | 'unreadable' };

/** Screen V4's client-side pre-check, run against whatever
 * `launchCameraAsync`/`launchImageLibraryAsync` returned, before ever
 * calling endpoint 1. */
export async function validatePickedAsset(
  asset: ImagePickerAsset,
): Promise<ClipValidationResult> {
  const mimeType = resolveMimeType(asset);
  if (!mimeType) {
    return { ok: false, reason: 'wrong_format' };
  }

  // `duration` is milliseconds per ImagePickerAsset's own doc comment; some
  // platforms/sources (certain Android camera apps) don't populate it at
  // all. When unknown, we don't have a client-side way to probe the real
  // duration (no ffprobe on-device) — declare the contract's own hard cap
  // rather than guessing low or high; the server's own (non-blocking)
  // ffprobe pass logs any real discrepancy, it doesn't reject on it.
  const durationSeconds =
    asset.duration != null ? Math.round(asset.duration / 1000) : CLIP_MAX_DURATION_SECONDS;
  if (durationSeconds > CLIP_MAX_DURATION_SECONDS) {
    return { ok: false, reason: 'too_long' };
  }

  let fileSizeBytes = asset.fileSize;
  if (fileSizeBytes == null) {
    try {
      const info = await FileSystem.getInfoAsync(asset.uri);
      fileSizeBytes = info.exists ? info.size : undefined;
    } catch {
      fileSizeBytes = undefined;
    }
  }
  if (fileSizeBytes == null) {
    return { ok: false, reason: 'unreadable' };
  }
  if (fileSizeBytes > CLIP_MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: 'too_long' };
  }

  return {
    ok: true,
    clip: {
      uri: asset.uri,
      mimeType,
      fileSizeBytes,
      durationSeconds: Math.max(1, durationSeconds),
    },
  };
}
