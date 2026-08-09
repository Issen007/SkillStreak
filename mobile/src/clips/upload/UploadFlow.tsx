import { useRef, useState } from 'react';

import { V4PickClip } from './V4PickClip';
import { V5CaptionChallenge } from './V5CaptionChallenge';
import { V6UploadProgress } from './V6UploadProgress';
import { V7Success } from './V7Success';
import { ClipUploadSession } from './clipUploadSession';
import { shouldPreUpload } from './shouldPreUpload';
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
  | {
      kind: 'caption';
      clip: PickedClip;
      /** Carried back from V6 when `complete` rejected the caption, so the
       * player returns to their own text and the reason, not a blank box. */
      caption?: string;
      taggedPlayerId?: string;
      captionError?: string;
    }
  | {
      kind: 'finishing';
      caption: string | undefined;
      taggedPlayerId: string | undefined;
    }
  | { kind: 'success' };

/**
 * Owns Screens V4-V7's step state.
 *
 * **The upload now starts at V4, not at V5's submit** (BACKLOG.md, from the
 * project owner's screenshots): a child used to sit watching a progress bar
 * that told them not to leave the app, at exactly the moment they might
 * give up. The bytes now move while they write the caption, so by the time
 * they press send the transfer is usually already done.
 *
 * That is why the session lives here rather than inside a screen — it has
 * to survive V5 unmounting into V6. Screens subscribe to it; none of them
 * owns it. The caption and tag are not part of the session at all: they do
 * not exist when it starts, and are sent at `complete` instead.
 */
export function UploadFlow({ teamId, viewerPlayerId, onCancel, onConsentRevoked, onPublished }: UploadFlowProps) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const sessionRef = useRef<ClipUploadSession | null>(null);
  // Kept so V6 can hand the player back to V5 without the flow having to
  // thread the picked clip through the 'finishing' step purely to return it.
  const pickedClipRef = useRef<PickedClip | null>(null);

  const abandon = () => {
    // Fire-and-forget: the child should not wait on a cancel round trip to
    // get back to the feed. The session aborts the transfer synchronously
    // before its own await, so nothing keeps uploading either way.
    void sessionRef.current?.cancel();
    sessionRef.current = null;
    onCancel();
  };

  if (step.kind === 'pick') {
    return (
      <V4PickClip
        onPicked={(clip) => {
          pickedClipRef.current = clip;
          const session = new ClipUploadSession(teamId, clip);
          sessionRef.current = session;
          // Start now only if we are not on a metered connection. On
          // cellular the session stays idle and starts at submit instead —
          // the pre-background-upload behaviour — so a family never pays
          // for a video their child then decides not to post. Not awaited:
          // the caption screen must appear instantly either way.
          void shouldPreUpload().then((preUpload) => {
            if (preUpload) session.start();
          });
          setStep({ kind: 'caption', clip });
        }}
        onCancel={abandon}
      />
    );
  }

  if (step.kind === 'caption') {
    return (
      <V5CaptionChallenge
        teamId={teamId}
        viewerPlayerId={viewerPlayerId}
        clip={step.clip}
        session={sessionRef.current}
        initialCaption={step.caption}
        initialTaggedPlayerId={step.taggedPlayerId}
        initialCaptionError={step.captionError}
        onSubmitted={(caption, taggedPlayerId) => {
          // No-op when the WiFi check already started it; the real start
          // for anyone on cellular.
          sessionRef.current?.start();
          setStep({ kind: 'finishing', caption, taggedPlayerId });
        }}
        onConsentRevoked={onConsentRevoked}
        onCancel={abandon}
      />
    );
  }

  if (step.kind === 'finishing') {
    return (
      <V6UploadProgress
        teamId={teamId}
        session={sessionRef.current}
        caption={step.caption}
        taggedPlayerId={step.taggedPlayerId}
        onSuccess={() => setStep({ kind: 'success' })}
        onEditCaption={(reason) => {
          // Back to V5 with everything intact. The session is untouched —
          // the bytes are already up, so only the metadata needs fixing.
          setStep({
            kind: 'caption',
            clip: pickedClipRef.current as PickedClip,
            caption: step.caption,
            taggedPlayerId: step.taggedPlayerId,
            captionError: reason,
          });
        }}
        onConsentRevoked={onConsentRevoked}
        onCancel={abandon}
      />
    );
  }

  return <V7Success onDone={onPublished} />;
}
