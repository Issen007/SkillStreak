import type { ClipMimeType } from '../../api/types';

/** The client-side pre-check's output — everything endpoint 1 needs, plus
 * the local file `uri` for the step-1-PUT that follows. Shared shape across
 * V4 (produces it) through V6 (consumes it for the `PUT`). */
export interface PickedClip {
  uri: string;
  mimeType: ClipMimeType;
  fileSizeBytes: number;
  durationSeconds: number;
}
