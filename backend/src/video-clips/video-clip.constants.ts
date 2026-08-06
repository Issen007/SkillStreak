// docs/adr/0010-video-storage-and-serving.md Decision 1/3 — the "hard cap,
// deterministic, no ML" technical-validity constants. These are code-level
// caps (allow-listed MIME types, a fixed file-size/duration ceiling), not
// runtime config: the ADR frames retention-window/pending-upload-TTL as the
// two genuinely tunable-without-a-new-ADR product knobs (see
// video-clips.service.ts's use of ConfigService for those two), while the
// upload allow-list/size/duration caps are the same kind of fixed,
// code-level validation boundary every other DTO in this app already uses
// (class-validator decorators against a literal, not an env var).
export const ALLOWED_CLIP_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const;

export type ClipMimeType = (typeof ALLOWED_CLIP_MIME_TYPES)[number];

// ~75MB — raised from the original ~25MB (2026-08-04, project owner
// request) to stay proportional to CLIP_MAX_DURATION_SECONDS's own 20s->60s
// increase at the same reasonable-mobile-capture-quality bitrate ADR-0010
// Decision 3 originally sized this against (~10 Mbps); leaving this
// unchanged while tripling the duration cap would have made the longer
// limit unusable in practice (real recordings would blow the size cap long
// before hitting 60s).
export const CLIP_MAX_FILE_SIZE_BYTES = 75_000_000;

// Raised from 20s to 60s (2026-08-04, project owner request) — originally
// matched the pitch's "15-sekundersklipp" plus a small buffer (ADR-0010
// Decision 3's recommendation); no longer tied to that original framing.
export const CLIP_MAX_DURATION_SECONDS = 60;

export const CLIP_CAPTION_MAX_LENGTH = 140;
export const CLIP_REPORT_NOTE_MAX_LENGTH = 140;

// ADR-0010 Decision 2 — "short-lived... a presigned PUT for upload expires
// in ~5 minutes... a presigned GET for playback expires in a similarly
// short window (recommend 5-10 minutes)".
export const CLIP_UPLOAD_URL_EXPIRES_SECONDS = 5 * 60;
export const CLIP_PLAYBACK_URL_EXPIRES_SECONDS = 10 * 60;

// ADR-0010 Decision 5's recommended defaults — overridable via
// CLIP_RETENTION_DAYS / CLIP_PENDING_UPLOAD_TTL_MINUTES (see
// video-clips.service.ts / clip-retention.service.ts), per the ADR's own
// "flagged, not silently decided as final" framing for these two numbers.
export const DEFAULT_CLIP_RETENTION_DAYS = 90;
export const DEFAULT_CLIP_PENDING_UPLOAD_TTL_MINUTES = 60;

// Non-blocking integrity signal (ADR-0010 Decision 3's optional extension):
// how far the ffprobe-measured actual duration may differ from the
// client-declared durationSeconds before it's worth a log line. Backend-
// developer's call per the ADR — implemented as a logged discrepancy, not a
// hard rejection (see VideoClipsService.completeUpload).
export const CLIP_DURATION_MISMATCH_TOLERANCE_SECONDS = 5;

const CLIP_MIME_TYPE_EXTENSIONS: Record<ClipMimeType, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Server-chosen file extension for the storage key (ADR-0010 Decision 1 —
 * `clips/{teamId}/{clipId}.{ext}`, never client-supplied). */
export function extensionForMimeType(mimeType: ClipMimeType): string {
  return CLIP_MIME_TYPE_EXTENSIONS[mimeType];
}

export const DEFAULT_CLIP_BUCKET = 'clips';
