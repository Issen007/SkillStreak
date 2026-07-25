import { useState } from 'react';

import { V4PickClip } from './V4PickClip';
import { V5CaptionChallenge } from './V5CaptionChallenge';
import { V6UploadProgress } from './V6UploadProgress';
import { V7Success } from './V7Success';
import type { CreateClipUploadUrlResponse } from '../../api/types';
import type { PickedClip } from './PickedClip';

interface UploadFlowProps {
  teamId: string;
  viewerPlayerId: string;
  /** Called when the flow is abandoned at any step (V4's "Avbryt", V5's
   * "Avbryt", V6's "Avbryt") — back to the feed, nothing published. */
  onCancel: () => void;
  /** Called mid-flow if a `403 consent_required` surfaces (stale-state
   * edge case — consent was revoked between opening the Klipp tab and
   * submitting here) — `ClipsScreen` re-fetches and lands back on V1. */
  onConsentRevoked: () => void;
  /** Called once the clip is actually published (V7's "Till flödet") —
   * `ClipsScreen` re-fetches the feed so the new clip appears from the
   * server's own response, not a locally spliced-in guess. */
  onPublished: () => void;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'caption'; clip: PickedClip }
  | {
      kind: 'uploading';
      clip: PickedClip;
      caption: string | undefined;
      taggedPlayerId: string | undefined;
      upload: CreateClipUploadUrlResponse;
    }
  | { kind: 'success' };

/** Owns Screens V4-V7's step state — the two-phase upload flow
 * (docs/design/phase3-flows.md Part A). Rendered full-screen over the
 * Klipp tab (`ClipsScreen`'s own local view toggle, same "no navigation
 * library" pattern `GoalScreen`/`TeamScreen` already use for their own
 * sub-views), not a separate route. */
export function UploadFlow({ teamId, viewerPlayerId, onCancel, onConsentRevoked, onPublished }: UploadFlowProps) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });

  if (step.kind === 'pick') {
    return <V4PickClip onPicked={(clip) => setStep({ kind: 'caption', clip })} onCancel={onCancel} />;
  }

  if (step.kind === 'caption') {
    return (
      <V5CaptionChallenge
        teamId={teamId}
        viewerPlayerId={viewerPlayerId}
        clip={step.clip}
        onSubmitted={(upload, caption, taggedPlayerId) =>
          setStep({ kind: 'uploading', clip: step.clip, caption, taggedPlayerId, upload })
        }
        onConsentRevoked={onConsentRevoked}
        onCancel={onCancel}
      />
    );
  }

  if (step.kind === 'uploading') {
    return (
      <V6UploadProgress
        teamId={teamId}
        clip={step.clip}
        caption={step.caption}
        taggedPlayerId={step.taggedPlayerId}
        initialUpload={step.upload}
        onSuccess={() => setStep({ kind: 'success' })}
        onConsentRevoked={onConsentRevoked}
        onCancel={onCancel}
      />
    );
  }

  return <V7Success onDone={onPublished} />;
}
