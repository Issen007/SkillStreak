# 0019 - Public opt-in Shorts feed, reactions & personal archive (Fas 6)

## Status

**Amended 2026-08-07 after the blocking security-reviewer pass — NOT a
clean sign-off. Verdict: cleared to build only as amended below, and only
after one prerequisite the project owner alone can close.** See "Security-
reviewer pass, 2026-08-07" at the end of this Status section for the full
outcome; every decision below now carries its amendments inline.

Proposed — 2026-08-02. **Blocking security-reviewer sign-off required
before ux-designer finalizes screens or backend-developer builds anything
against this**, per CLAUDE.md's standing rule and per `docs/ACTION_PLAN.md`'s
own explicit framing for this phase ("higher-risk than Fas 3... treat it
that way, with security-reviewer **blocking**, before any schema or
endpoint exists"). This ADR should get no lighter a review than ADR-0010's
original pass, which returned a required GPS-metadata-leak fix, not a
rubber stamp — it is a deliberate, narrow crack in the exact structural
guarantee ADR-0010 built for that phase, and every decision below should be
read as "argue for why this specific crack is safe," not "assume it is."

Three things for security-reviewer to scrutinize hardest, named up front so
they aren't buried in the decisions below: (1) Decision 1's new
*unauthenticated* video-preview surface for the mailed parent-review link —
the first time this app has ever served real child video to an endpoint
that isn't gated by either team membership or an active session; (2) the
consent-copy conflict this ADR surfaces (below) — an existing, live,
8-language promise this feature makes false the moment it ships; (3)
whether the 13+ self-verification cohort's self-approval path (Decision 1)
is actually a sound extension of ADR-0002's Art. 8 reasoning, or a
different question this ADR shouldn't have answered unilaterally.

### Security-reviewer pass, 2026-08-07 — full weight, not a clean sign-off

Ran as the blocking pass this Status section demanded, then adversarially
re-verified by a code-critic pass before any amendment was written here —
which materially corrected three of the security-reviewer's own findings
(see "Findings raised and rejected" below). Both passes read the real
codebase; the amendments below cite what was actually verified, not what
this ADR claimed.

**The one prerequisite this ADR cannot close by itself, and the reason the
verdict isn't a plain sign-off**: this feature contradicts CLAUDE.md's
standing non-negotiable *"Closed team bubbles — no data/video/comments
public by default; a user only ever sees their own verified team."* The
first clause survives (this is opt-in, per-clip, parent-approved). The
second does not, and CLAUDE.md instructs every agent in this repo to push
back on anything weakening it — so no ADR can self-certify past it.
**Shipping requires the project owner to amend that sentence in CLAUDE.md
themselves** (e.g. *"…only ever sees their own verified team, except for
individual clips the uploader has published through ADR-0019's per-clip
approval gate"*). Until that edit exists, this ADR stays blocked
regardless of everything else here. `docs/internal/ACTION_PLAN.md`'s Phase
6 section already records this as an owner-requested feature with the
conflict named, so this is a wording decision, not a reopening of the
product question.

**Four blocking design changes, all folded into the decisions below**:
(1) Decision 8's feed query had **no viewer-side gates at all** while the
existing team feed has three — amended in Decision 2; (2) the feed query
never filtered `VideoClip.status`, so a team-reported (`hidden`) clip
would vanish for the ~15 people who know the child in person and stay
visible to every stranger in the app — amended in Decisions 4/6/8; (3) the
consent-copy prerequisite was scoped to one file when the promise is live
in six surfaces — amended in Consequences; (4) the approving recipient had
no way back, uniquely among this app's four consequential mailed-approval
flows — amended in Decision 1.

**Five cheap, reuse-shaped amendments** (approve/decline preconditions and
single-use semantics; who sets `expired`; refusing re-publication after a
`reported` revoke; reusing the existing block table; pinning the reaction
read model) and **two hardening asks** on the unauthenticated preview page,
also inline below.

**The single most useful thing both passes surfaced**: ADR-0023 Decision A3
already built PT per-player consent by explicitly reusing *this ADR's*
mailed review-and-approve pattern — so `backend/src/pt/pt-consent.service.ts`
is the **shipped, already-reviewed reference implementation of the exact
state machine this ADR describes in prose**. Several amendments below are
therefore not new design at all, just "do what `pt-consent` already does":
`approveByReviewCode`/`declineByReviewCode` (`:329-404` — pessimistic write
lock, status + liveness recheck, null the code), the non-expiring
`revokeCode` minted at approval and mailed to the approver (`:347-378`,
`revokeByRevokeCode` at `:433`), and the lazy expiry of a stale
`pending_review` row so the partial unique index can't wedge the entity
forever (`:156-175`). Anyone implementing this ADR should read that file
first and diverge from it only where this ADR says why.

**Two real bugs in already-shipped code** were found along the way, both
out of this ADR's scope and filed in `docs/internal/BACKLOG.md` rather
than fixed here: `ClipRetentionService.sweepExpiredPublishedClips`
(`backend/src/video-clips/clip-retention.service.ts:64-69`) selects
`status: PUBLISHED` only, so a `hidden` (team-reported) clip is **never**
retention-swept — it and its MinIO object persist past 90 days
indefinitely, contradicting `docs/legal/terms-of-service-DRAFT.md`'s own
retention promise; and `pendingParentContact` is never cleared when a
`contactChangeCode` expires unused (`backend/src/player-private-info/
player-private-info.service.ts:122-292` — all three clearing paths require
the confirm step), latching `hasPendingContactChange` true forever and
silently barring that player from account erasure today, and from
publishing once this ships. This ADR's Decision 1 depends on the second
one being fixed.

**Findings raised and rejected** — recorded so they aren't re-raised by the
next reader: (a) a *"viewer must belong to a team they didn't create"*
gate was proposed and **rejected as unimplementable and wrong** — `Team`
has no creator/founder column (`backend/src/teams/entities/team.entity.ts`
— only `id`, `name`, `invite_code`) and `isCaptain` is a transferable role
per ADR-0006, so it needs new schema; it would permanently bar the
founding captain of every legitimate self-service team (the exact users
ADR-0009 exists for); and it doesn't even work, since registering a second
account against the first one's invite code defeats it in a minute. (b) a
new `PublicFeedBlock` entity was proposed and **rejected as a duplicate**:
`TeamChatBlock` has **no team column at all** (verified — `blocker_player_id`,
`blocked_player_id`, `created_at`, and nothing else), is already reused
verbatim by the clip feed and chat attachments, and is the right table to
reuse here; its team-scopedness lives in the surfaces, not the schema. (c)
swapping `generateHumanCode` (40 bits) for the 256-bit `generateConsentToken`
on the 7-day review link was **downgraded from required to recommended**:
the concern is real, but the identical choice (a `generateHumanCode` review
code on a 7-day TTL, `backend/src/pt/pt.constants.ts:6`) is already shipped
in `pt-consent` gating something comparably heavy, and already passed its
own full-weight review — so it's a tightening to apply to both flows or
neither, not a gate on this one. See Decision 1's note.

## Context

`docs/ACTION_PLAN.md`'s Phase 6 (added 2026-07-27, read in full before this
ADR was drafted): an endless-scroll feed of clips other players have opted
to make public, with reactions; a personal archive to save clips for
inspiration; and an "Archive" tab in Shorts showing a player's team's clips
and their own clips, from which one can be published to the public feed.
Reference points named (Snapchat/YouTube/TikTok/Instagram) are for the
scroll/reaction UX mechanic only, explicitly not for their privacy models.

**Why this is different from every prior feature in this app**, restated
because it's the entire premise of this ADR: `docs/adr/0010-video-storage-
and-serving.md` makes a clip's bytes **structurally** unreachable outside
the uploader's own team — zero public/anonymous read access on the bucket,
every read re-checks `clip.teamId === requestingPlayer.teamId`, enforced at
two independent layers (security-reviewer independently verified both).
This request is, by definition, this app's first deliberate cross-team
visibility path for children's video. This ADR does not loosen that
guarantee for the *team* surface at all — `VideoClip`, its existing
`status`/team-scoping, and every read path ADR-0010 already built are
completely unchanged. What this ADR adds is a second, narrow, opt-in,
per-clip-approved path that runs **alongside** it, gated by a materially
stronger consent event than anything else in this app has ever required.

**A real, unprompted finding, surfaced before any decision below, because
it's load-bearing for Decision 1**: the existing account-level consent
copy (`backend/src/consent/consent-page.templates.ts`, all 8 locales)
makes an **unqualified promise**, e.g. (English): *"anything [player] shares
— including any video clips — is only visible to their own team."* Every
other locale says the same thing (`nur für das eigene Team sichtbar`, `bare
synlig for sitt eget lag`, `n'est visible que par sa propre [équipe]`,
etc.). This is the same class of bug ADR-0018's security-reviewer pass
caught for the "no photos or location data" claim five days after video
upload shipped — a copy promise that was true when written and becomes
**false** the instant this feature ships, for every existing parent who
already read and relied on it. **This is not optional transparency
polish**: shipping public opt-in publishing without correcting this copy
means every current family's consent was given under a promise this app
would then be actively contradicting. Decision 1 treats fixing this as a
hard prerequisite, not a nice-to-have, and flags it explicitly for
security-reviewer to confirm is actually closed (mirroring exactly how
ADR-0018's fix was verified: grepped for the old claim across the whole
tree, not just patched the one line that prompted the finding).

Also confirmed by reading the current schema/ADRs directly before drafting,
not assumed: `docs/adr/0002-data-model.md`'s 2026-07-27 addendum means the
13+ self-verification cohort has **no parent contact on file at all, by
design** — `PlayerPrivateInfo.parent_contact` holds the player's *own*
verified email for that cohort. Any design that assumes "publishing
requires a parent to click a link" without an explicit answer for this
cohort leaves a real population with an undefined path, which
`docs/ACTION_PLAN.md`'s own task list explicitly calls out as
unacceptable to leave open.

## Decision — 1: publish-approval is a new, standalone per-clip workflow — layers on top of, never replaces, account-level consent

### The project owner's 2026-07-27 candidate, evaluated

The candidate proposes a verified "child email" per player (doing double
duty as a future login-recovery credential) plus one or two separate
parent emails, with a parent reviewing and approving a *specific clip*
before it can go public.

**Two ideas are bundled in that candidate that this ADR deliberately
separates:**

1. **A new, verified "child email" as a login-recovery credential** — this
   is `docs/ACTION_PLAN.md`'s Fas 4 point 2 (new-device login/session
   reissue), a materially larger, separate architecture decision (does it
   replace `parent_contact`? Does it change the session-reissue mechanism
   ADR-0004's addendum already built? Does it need its own verification
   flow distinct from the existing consent-link mechanism?). **This ADR
   does not build it.** Building a whole second identity/credential system
   as a side effect of a video-feed ADR would be exactly the kind of scope
   creep CLAUDE.md warns against ("build for the phase actually in front of
   us"). If/when Fas 4 point 2 is designed, it can reuse whatever this ADR
   ships (the same `MailService`/single-use-code infrastructure), but that
   reuse is a future decision, not this one.
2. **A materially stronger, per-clip approval gate than account-level
   consent, where a parent (or, per below, the player themself) actually
   sees the specific clip before approving it.** This is squarely this
   ADR's scope, and is the leading, adopted design below.

**Decision: no new "child email" field, no new second/third parent-email
fields.** `PlayerPrivateInfo.parent_contact` — the same single field every
other consequential action in this app already routes through (consent,
session reissue, contact-email change, account erasure) — is reused as-is
for the publish-approval recipient. Adding "one or two parent emails" would
be new scope touching onboarding/consent broadly (every other feature in
this app assumes exactly one contact), not something this ADR should
introduce as a side effect of one feature; flagged as a plausible future
idea, not designed here.

### Does this replace or layer on top of the existing `parentalConsentStatus` gate?

**Layers on top, strictly additive.** A player cannot have an existing
`VideoClip` row at all unless account-level consent was already `approved`
at upload time (CLAUDE.md's "parental approval flow required before any
account can upload video/media," already enforced pre-existing to this
ADR) — so by the time a clip exists to publish, the account-level gate has
already, necessarily, passed. This ADR's new gate answers a **different**
question ("should *this specific piece of content* reach an audience wider
than the team the original consent was scoped to"), not a repeat of the
same question. Concretely: requesting publication also re-checks the
uploader's **current** `parentalConsentStatus === approved` (not just "was
approved once") — cheap defense-in-depth, since consent can move to
`revoked` after upload.

### The 13+ self-verification cohort — decided, flagged as needing confirmation beyond pure engineering

For this cohort, `parent_contact` holds the player's own verified email —
there is no parent anywhere in the schema to loop in, by design. **Decision:
the identical review-and-approve-a-specific-clip flow is sent to the same
address already on file** — the player's own — rather than inventing a
parent-only mechanism that structurally cannot reach this cohort at all.
This keeps the mechanism uniform (one flow, one set of endpoints, the exact
same age-band branching `isSelfVerificationAge` already does for every
other `parent_contact`-routed email in this app — consent, session reissue,
contact-change, erasure — no new special-casing introduced) and closes a
real "compromised/borrowed session" gap the same way ADR-0012/0013 already
reasoned through for their own consequential actions: a bare in-app tap
from a borrowed device shouldn't be enough to make a child's video public
on its own; forcing a fresh, out-of-band email loop closes that regardless
of whether the recipient is a parent or the player themself.

**Flagged explicitly, not decided silently, per this project's own "say so
rather than pick silently" practice**: whether Swedish GDPR Art. 8's
self-consent floor (already the basis for letting 13+ players self-consent
to *account creation and ordinary processing*, per ADR-0002's 2026-07-27
reversal) also legitimately extends to *"consenting to make my own video
visible to a wider, cross-team audience"* is a genuinely different
question than the one that reversal answered, and this ADR is not
confident it's purely a technical judgment call. The mechanism above (send
the same review-and-approve email to the self-verified player's own
address) is this ADR's recommended default, built to be trivially
extendable if the project owner (with a real legal read, if warranted)
decides 13+ players should *not* be able to self-approve publishing without
some other check — the state machine below doesn't hardcode which
recipient type is allowed to approve, so tightening this later (e.g.
requiring a coach or a different confirmation step for this cohort
specifically) is a policy/routing change, not a schema change.

### New table: `ClipPublicationRequest`

A separate table, not new columns on `VideoClip` — argued, not asserted.
This state has real, ongoing legal weight (consenting to a specific
child's video reaching a wider audience) of the same category ADR-0002
already gives `ParentalConsentRecord` its own table for ("a single mutable
status field tells you the *current* state; this table proves *when and
how* it changed") and ADR-0013 gives `AccountErasureRequest` ("the whole
point of this state is to outlive the row it's about" — here, to outlive
each individual publish *attempt*, since a clip may be requested, declined,
and re-requested more than once). Keeping `VideoClip` itself untouched also
means ADR-0010's already-reviewed, already-shipped entity stays stable —
an additive new table is a strictly safer change than adding new mutable
state to it.

```
ClipPublicationRequest
  id                          uuid, PK
  clip_id                     uuid, FK -> video_clip.id, ON DELETE CASCADE
                                 -- see "Why CASCADE" below
  uploader_player_id          uuid, FK -> player.id, ON DELETE CASCADE
                                 -- denormalized from clip.uploaderPlayerId at
                                    creation, query convenience only (same
                                    team_id-on-TrainingLogEntry pattern
                                    ADR-0002 already establishes) — clip_id's
                                    own cascade is what actually matters
  status                       enum: pending_review / approved / declined /
                                      revoked / expired
  review_code                  varchar, nullable, unique
                                 -- generateHumanCode, same utility every
                                    other mailed-code flow in this app
                                    already reuses. Nulled on decision —
                                    see the approve/decline preconditions
                                    below; single-use, never replayable.
                                 -- SECURITY-REVIEWER NOTE (2026-08-07,
                                    recommended, deliberately NOT blocking):
                                    generateHumanCode is 8 chars over a
                                    32-symbol alphabet = 40 bits, and this
                                    is its longest-lived use (7 days) as
                                    well as the only one that unlocks media
                                    rather than a text decision.
                                    generateConsentToken (256 bits, also
                                    7-day) is the better-matched primitive
                                    for a link that is clicked, never
                                    typed. Not gated on here because the
                                    identical choice is already shipped and
                                    already review-passed in pt-consent
                                    (pt.constants.ts:6) — swapping one and
                                    not the other would leave the live
                                    surface untouched and make the two ADRs
                                    inconsistent. Do both, or neither.
  revoke_code                  varchar, nullable, unique
                                 -- minted at APPROVAL time, never expires,
                                    mailed to the approver in the approval-
                                    confirmation email. Copied verbatim from
                                    PtConsentService.approveByReviewCode/
                                    revokeByRevokeCode. See "the approver
                                    needs a way back" below.
  review_code_expires_at       timestamptz, nullable
                                 -- recommend 7 days (longer than the 15min/
                                    24h norms elsewhere — this decision
                                    requires actually watching a clip, not
                                    just clicking a link; a genuinely bigger
                                    single-sitting ask than anything else
                                    mailed in this app). Tunable config,
                                    same "left open, not a schema decision"
                                    posture ADR-0010's numeric caps already
                                    have.
  recipient_contact_snapshot   varchar, nullable, encrypted (AES-256-GCM,
                                 same utility as PlayerPrivateInfo/
                                 AccountErasureRequest) — see the
                                 contact-change-race fix below
  decided_at                   timestamptz, nullable
                                 -- when status became approved/declined;
                                    doubles as "publishedAt" for feed
                                    ordering when status = approved
  revoked_at                   timestamptz, nullable
  revoked_reason               enum, nullable: owner_unpublished / reported /
                                 recipient_withdrawn (added 2026-08-07 —
                                 see "the approver needs a way back")
  created_at                   timestamptz
```

Only one **active** (`pending_review`/`approved`) row per `clip_id` at a
time — a partial unique index on `clip_id WHERE status IN
('pending_review', 'approved')`, the identical mechanism
`AccountErasureRequest`'s own single-active-row invariant already uses. A
clip can accumulate a real history of multiple past requests (declined,
then later re-requested and approved, etc.) — that history stays, giving a
genuine audit trail of every approval decision ever made about this
specific clip, not just the current state.

**Amendment (security-reviewer, 2026-08-07) — say who sets `expired`, or
the partial index wedges the clip forever.** As originally written, this
ADR defined an `expired` status that *nothing in it ever sets* — the
identical defect a code-critic pass already caught in ADR-0023, with the
same consequence here: a `pending_review` row whose review link lapsed
unused stays inside the partial unique index's scope, so that clip could
never be requested for publication again. **Fix, copied from the shipped
version of that same fix (`pt-consent.service.ts:156-175`)**: when a new
publish-request arrives for a clip that already has a `pending_review` row
whose `review_code_expires_at` has passed, lazily transition that row to
`expired` (setting `decided_at`) and continue, rather than refusing 409. A
genuinely live `pending_review` row still refuses, as specified.

**Why `ON DELETE CASCADE` from `VideoClip`, not the `ClipReport`-style
"outlives the clip" pattern**: `ClipReport` survives its clip because it's
an accountability record about a *person's action* (a report was filed,
against this player, for this reason) that matters independently of the
video's own lifecycle. `ClipPublicationRequest` has no such independent
value — it's a record about *this specific video's* visibility, worthless
once the video itself is gone. This is the identical reasoning
`docs/adr/0018-ai-video-content-tagging.md` Decision 4 already gives for
why `VideoClipTag` cascades rather than survives — stated explicitly here
so a future contributor doesn't copy `ClipReport`'s pattern by analogy
instead. The practical payoff (see Decision 7): every existing deletion
path that already deletes a `VideoClip` row — the 90-day retention sweep,
uploader self-delete, and ADR-0013's account-erasure walk — takes this
table with it automatically, with **zero** new code to write or remember.

### The contact-change-hijack race — reuses ADR-0013 Decision 2's fix verbatim, not re-derived

This is the identical vulnerability class ADR-0013's security-reviewer
pass already found and fixed for account erasure, applied to a new
consequential action that also resolves `parent_contact`: a contact-email
change in flight at request time could let an attacker-controlled address
receive the review code and silently approve (or, arguably worse, silently
decline and thereby suppress) a specific clip going public, with the real
family never seeing it. **Fix, reused exactly**: before creating a
`ClipPublicationRequest`, check `PlayerPrivateInfoService
.hasPendingContactChange(playerId)` (the same direct, non-lazy-applying
read ADR-0013 added) and refuse with `409
publish_blocked_pending_contact_change` if one is in flight. Once cleared,
`getParentContact()` is called exactly once, and the resolved value is
snapshotted (encrypted) onto `recipient_contact_snapshot` — never
re-resolved for the lifetime of this request, closing the same retargeting
window ADR-0013 already closed for erasure.

**Amendment (security-reviewer, 2026-08-07) — the reuse is the right one,
but it does not transfer cleanly as-is; one upstream fix is a
prerequisite.** `PlayerPrivateInfoService.hasPendingContactChange` is
genuinely the raw, non-lazy-applying read this ADR claims (verified,
`player-private-info.service.ts:287-292`), and snapshotting the resolved
contact really does close the retargeting window (verified against
`AccountErasureService.requestErasure`, which resolves `getParentContact()`
exactly once and decrypts the snapshot rather than re-resolving). What
doesn't transfer is the cost of a **false positive**: `pendingParentContact`
is set at `setPendingContactChange` and cleared in exactly three places
(`:174`, `:236`, `:258`), **all three of which require the confirm step to
have already happened**. Nothing clears it when a `contactChangeCode`
merely expires unused, and there is no authenticated "cancel my pending
change" route. So a player who starts a contact-email change, mistypes it,
and never confirms latches `hasPendingContactChange` true indefinitely.

For erasure — once in a lifetime, and recoverable by re-running the change
to completion — that was a tolerable latent bug. For publishing — routine,
repeated, and presented to a 10-year-old as an unexplained 409 — it is
not. **Prerequisite fix, upstream in `PlayerPrivateInfoService`, not
here** (it also fixes the same dead end in ADR-0013's shipped erasure
path): treat a `contactChangeCode` that has expired with no grace period
started as *not* pending — or, preferably, add an authenticated
`POST /api/v1/players/me/contact-change-cancel` that clears
`pendingParentContact`/`contactChangeCode`/`contactChangeCodeExpiresAt`.
Filed in `docs/internal/BACKLOG.md`. The 409
`publish_blocked_pending_contact_change` behaviour above is unchanged and
correct once that latch can actually clear.

### Endpoints

Authenticated (`/players/me/...`, uploader-only — no captain/coach
override, same "no peer authority over another's content" posture
ADR-0010's self-delete already established; a captain gets no special role
here either, consistent with every prior rejection of captain-as-content-
authority in ADR-0007/0010):

```
POST /api/v1/players/me/clips/:clipId/publish-request
  -> { requested: true, expiresAt }
  Requires clip.uploaderPlayerId === requester, current
  parentalConsentStatus === approved, no existing active
  ClipPublicationRequest for this clip (409 if one exists).
  Refuses 409 publish_blocked_pending_contact_change per above.
  Rate-limited (burst + daily cap), same RedisService pattern as
  session-reissue/contact-change/erasure-request — the realistic abuse
  surface is identical: a compromised session spamming a family's inbox.

GET /api/v1/players/me/clips/:clipId/publication-status
  -> { status: 'none' | 'pending_review' | 'approved' | 'declined' |
       'revoked' | 'expired', decidedAt?, revokedReason? }
  Backs an in-app "waiting for review" / "public" / "declined" state,
  same polling-a-status-endpoint pattern as ADR-0013's erasure-status
  banner — no push-notification infra exists in this app to do better.

POST /api/v1/players/me/clips/:clipId/unpublish
  -> { unpublished: true }
  Valid from EITHER pending_review or approved (covers both "I changed my
  mind before my parent even answered" and "take this down, it's already
  public") — one action, not two near-duplicate endpoints. Sets status =
  revoked, revokedReason = owner_unpublished, immediately and
  unconditionally, even if the clip currently has open public reports —
  the exact same self-determination posture ADR-0010 already gives
  self-delete ("even if the clip has open reports... real
  self-determination over your own upload").
```

Unauthenticated (the mailed review link — mirrors `ConsentController`/
`erasure-confirm`'s GET-preview/POST-action split, throttled per-IP the
same way):

```
GET /api/v1/clip-publication/:code
  -> a preview page: an embedded video player (see below), the clip's
     uploader's screen name, and Approve/Decline buttons. No side effects
     from the GET itself (email-scanner-prefetch-safe, same reasoning
     ConsentController/erasure-confirm already established).

POST /api/v1/clip-publication/:code/approve
  -> sets status = approved, decided_at = now(); the clip becomes
     immediately visible on the public feed.

POST /api/v1/clip-publication/:code/decline
  -> sets status = declined, decided_at = now().
```

**Amendment (security-reviewer, 2026-08-07) — approve/decline had no
stated preconditions and no single-use semantics; as written they permit
resurrect-after-unpublish.** Concretely, using only actions this ADR
itself defines: the child taps `unpublish` while the review email is still
unread (`status → revoked`, review code untouched per the schema block);
the parent clicks Approve the next day; a literal implementation flips
`status → approved` and republishes the clip the child deliberately
withdrew. Same shape for approve-after-decline and for replaying the link.

**Fix — no new design, copy `PtConsentService.approveByReviewCode` /
`declineByReviewCode` (`pt-consent.service.ts:329-404`) verbatim**, which
already implements exactly this state machine because ADR-0023 Decision A3
built it from this ADR's own pattern:

```
POST /api/v1/clip-publication/:code/approve
  Inside a single transaction, re-read the ClipPublicationRequest with
  .setLock('pessimistic_write') on the code lookup, then re-check ALL of:
    status === 'pending_review'
    review_code has not expired (isReviewCodeLive-equivalent)
    clip still exists and clip.status === 'published'
    uploader's CURRENT parentalConsentStatus === 'approved'
  Any other state returns null -> the friendly already-decided/invalid
  page, never a raw error (same as PtConsentPublicController).
  On success: status = approved, decided_at = now(),
    review_code = NULL, review_code_expires_at = NULL,
    revoke_code = generateHumanCode(0)   -- non-expiring, see below
  Nulling the code is what makes approve single-use and makes
  unpublish-then-approve structurally impossible, not just unlikely.

POST /api/v1/clip-publication/:code/decline
  Identical lock, identical preconditions, identical code-nulling.
```

`POST /players/me/clips/:clipId/unpublish` likewise nulls `review_code`
when it revokes, so an unread review email dies with the withdrawal
rather than lingering as a live re-publish lever.

### The approver needs a way back — a revoke link, not just an approve link

**Amendment (security-reviewer, 2026-08-07).** As originally written, the
`unpublish` endpoint is `/players/me/...` — session-authenticated,
uploader-only. So a parent who watches a clip, approves it, and then has
second thoughts has **no lever at all**: no take-down link, no way to
reverse the one decision this whole gate exists to give them. This is the
only one of this app's four consequential mailed-approval flows where the
recipient gets no way back — erasure has `erasure-cancel/:code`, contact
change has `contact-change-cancel/:code` (which even bumps
`token_version`), and PT consent mints a **non-expiring** `revokeCode` at
approval time and mails it to the same recipient
(`pt-consent.service.ts:347-378`, `revokeByRevokeCode` at `:433`).

Adopted, copying that last one exactly — `revoke_code` on the schema
above, minted at approval, included in the approval-confirmation email:

```
GET  /api/v1/clip-publication-revoke/:revokeCode   (preview, no side effects)
POST /api/v1/clip-publication-revoke/:revokeCode
  -> sets status = revoked, revoked_reason = 'recipient_withdrawn',
     immediately and unconditionally, for as long as the clip is public.
     Same GET-preview/POST-action split and same response headers as the
     review page below.
```

Note also, since Decision 1's "cheap defense-in-depth" sentence relies on
it: **no code path in this repo ever writes
`ParentalConsentStatus.REVOKED`** (verified — the only non-test references
are two *reads* in `weekly-goal.service.ts`). Re-checking current consent
at approve time is still correct and free, and should stay; the
justification "since consent can move to `revoked` after upload" is simply
false today and must not be relied on as the parent's escape hatch. The
revoke link above is that escape hatch.

### The new unauthenticated video-preview surface — named explicitly as new attack surface, not glossed over

Every prior unauthenticated mailed-link page in this app (consent,
session-reissue redemption, contact-change-cancel, erasure-confirm) only
ever rendered **text describing an action** — none has ever served actual
child media. This one does, because "actually see the clip before
approving" is the entire point of the stronger gate. Concretely: the GET
preview page renders an embedded player sourced from a **freshly-minted,
short-lived presigned MinIO GET URL**, minted by the exact same
`VideoClipsService` logic ADR-0010 Decision 2 already uses for the team
feed — same short expiry, same "minted fresh per request, never persisted
or cached" rule — just gated on **"this one-time code, not yet
decided/expired, unlocks read access to this one specific `clip_id`"**
instead of team membership. This is structurally the same shape as every
other presigned-URL grant in this app (short-lived, single-purpose,
re-derived every time, never a durable public link), extended to a
recipient who authenticates via a mailed single-use code instead of a
session — the residual risk is the same one ADR-0010 already accepts and
states plainly for every presigned URL ("a legitimately-issued URL could be
copy-pasted outside the app during its short validity window"), now
applied to a code mailed to an inbox by design rather than to an in-app
session. **This is the single item this ADR most wants security-reviewer
to pressure-test hard** — it's a genuinely new category of surface for
this app, not a copy of an existing one.

**Amendment (security-reviewer, 2026-08-07) — the presigned-URL reuse
holds; the "prefetch-safe" reuse does not, and no response headers were
specified.** Two corrections, both cheap:

1. **The GET must not embed a playable source.** `ConsentController`'s
   prefetch-safety comment (`consent.controller.ts:31-35`) is explicitly
   about *state mutation* — "if this GET performed the approval, consent
   could be auto-granted." That reasoning is sound and does carry over.
   What does not carry over is the property being protected: every prior
   mailed page in this app rendered text only, so a link-detonating email
   security gateway (Proofpoint, Defender ATP, and friends) fetching the
   page cost nothing. A page whose body contains a live presigned URL to a
   named child's video means those gateways **download the child's video
   into a third-party sandbox with no human ever involved** — a real
   disclosure, and a genuinely new consequence of prefetch rather than a
   copy of the old one. **Fix**: the GET renders metadata only (uploader
   screen name, duration, the approve/decline controls) plus an explicit
   "Show the video" control that issues a plain HTML form POST to
   `/api/v1/clip-publication/:code/preview-url`, which mints the presigned
   GET URL and returns the page with the player embedded. A prefetching
   scanner gets metadata; only a real interaction unlocks bytes. That POST
   is throttled per-IP and per-code and is a no-op for a
   decided/expired/revoked request. **Use a form POST, not client-side
   fetch** — these pages are deliberately no-JS and self-contained
   (`transactional-page.util.ts`), and that property is worth keeping.
2. **Set response headers on these routes.** Verified:
   `renderTransactionalHtmlPage` (`common/html/transactional-page.util.ts:15-33`)
   sets no headers at all, and `main.ts` installs no `helmet` — harmless
   for four text-only pages, not harmless for a page carrying a live
   credential to child video. Every route on this controller (and the
   revoke controller above) sets `Cache-Control: no-store, no-cache,
   must-revalidate`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`,
   and `X-Robots-Tag: noindex, nofollow`, via `res.setHeader` on these
   specific routes — **not** by adding `helmet` app-wide, which would be a
   new dependency affecting every endpoint for one page's benefit.

## Decision — 2: scope of "public" — app-wide among authenticated SkillStreak players, never outside the app

Decided deliberately, not by analogy to the four named reference apps, per
the explicit instruction. The real options for *this* codebase:

- **App-wide (any SkillStreak player, any team)** — the option adopted.
- **Some narrower circle** (e.g. same club/region) — rejected as
  unbuildable without inventing new infrastructure this phase doesn't have:
  no club/region/geography concept exists anywhere in this schema (and per
  CLAUDE.md, never will — "no location tracking, ever"). The only
  grouping concept that exists at all is `Team`, and a circle scoped to
  "teams like mine" with no defined membership rule would be a new,
  undesigned feature in its own right, not a smaller version of what was
  asked for.

**Bounded the other way, explicitly**: "app-wide" means app-wide *among
authenticated players* — there is no public/anonymous URL, no unauthenticated
web view, no CDN-cacheable link for a public clip, ever. Every public-feed
read still mints a fresh, short-lived presigned URL after re-checking the
clip's current `ClipPublicationRequest.status === approved`, the same
"structural, re-checked on every single read" bar ADR-0008/0010 already
set for their own cross-boundary features — this feature crosses the
*team* boundary (by design, opt-in), it does not cross the *authenticated
app* boundary at all. This mirrors the exact boundary the leaderboard
(ADR-0008) already normalized: cross-team, never cross-app.

### Amendment (security-reviewer, 2026-08-07) — "authenticated player" is not a trust boundary, and the feed had no viewer-side gates at all

This is the pass's most serious finding. Decision 2 as originally written
rests its entire safety argument on the word *authenticated* ("this
feature crosses the *team* boundary… it does not cross the *authenticated
app* boundary at all"). Verified what an authenticated player account
actually costs to obtain:

- `POST /api/v1/players` is **unauthenticated**, throttled at 10/min/IP
  only (`onboarding.controller.ts:39-44`).
- `birthYear` is entirely self-declared — an `@IsInt` in a 1970–2022
  window, unverifiable (`create-player.dto.ts`).
- An `inviteCode` that matches no team, plus a `teamName`, becomes the
  *create-a-team* path (`onboarding.service.ts:96-100, 241-271`) — no
  contact with any real coach or team is needed.
- The founding captain is created `teamJoinStatus: APPROVED`
  (`players.service.ts:100-108`).
- For a self-declared 13+ birth year, the verification email is sent to
  `dto.parentContact` — **an address supplied in the same request**
  (`onboarding.service.ts:110, 178-197`) — and clicking it sets
  `parentalConsentStatus = APPROVED` (`players.service.ts:755`).

So an arbitrary adult holds a fully-consented, fully-approved player
account in about sixty seconds. **Today that is harmless**, and that is
exactly why nobody has had to care: ADR-0010's closed bubble means such an
account sees only its own empty team. This ADR is what converts it into an
unrestricted viewer of an app-wide feed of real 9–13-year-olds' faces and
voices, with bookmarking and a per-clip signalling channel back to each
child. The leaderboard analogy this decision leans on does not rescue it —
ADR-0008 exposes an integer.

Compounding it: Decision 8's query specified **no viewer-side predicates
whatsoever**, while the existing team feed gates on three
(`VideoClipsService.listClips:551-556` — `assertTeamMembership` →
`assertConsentApproved` → `assertTeamJoinApproved`). The highest-exposure
read path in the app was specified as the *least*-gated one.

**Adopted, and required before any implementation:**

1. Reading the public feed, reacting, saving, or reporting requires the
   **viewer's** `parentalConsentStatus === 'approved'` **and**
   `teamJoinStatus === 'approved'` — mirroring `listClips`'s existing
   chain exactly, so the public path is never weaker than the team path.
   Cheap, boring, no new schema. (Noted for calibration: this is a
   *tightening* relative to precedent, not a restoration — the existing
   cross-team read, the leaderboard, gates on team membership alone.)
2. **The registration-boundary residual is stated plainly here rather
   than papered over by the word "authenticated."** Anyone can hold a
   self-approved account in ~60 seconds. The real mitigations for this
   feature are the per-clip approval gate, `teamName` never being
   serialized, `taggedPlayerId` never being resolved, short-lived
   presigned URLs, and report→revoke — *not* the account boundary. Any
   future reasoning about this feature must argue from that list.
3. **Open, and explicitly for the project owner, not an engineering
   call**: there is **no upper age bound anywhere in this app** and no
   viewer-role concept, so an ordinary self-registered `Player` with a
   declared `birthYear` of 1985 is indistinguishable from a child. (The
   `pt`/`admin` staff roles ADR-0023 adds are *not* the concern — they
   authenticate through a separate guard.) Whether adult-aged accounts may
   browse children's clips at all, and whether anything should verify
   that, is a product/legal decision. If the owner wants a real boundary
   rather than a stated residual, the honest option is a **per-account,
   parent-approved "may browse the public feed" opt-in reusing the exact
   mailed review-and-approve machinery this ADR already builds** — one
   more use of an existing mechanism, no new infrastructure.

Two viewer-gate proposals were **considered and rejected**: a "viewer must
belong to a team they didn't create" predicate (unimplementable — `Team`
has no creator column and `isCaptain` is transferable per ADR-0006; it
would permanently bar the founding captain of every legitimate
self-service team, the exact users ADR-0009 exists for; and registering a
second account against the first's invite code defeats it in a minute),
and re-litigating the 13+ self-approval question, which Decision 1 already
flags as open and non-technical.

No team-level opt-out toggle (e.g. a captain disabling publishing for the
whole team) is built — considered and rejected for the same reason every
prior captain-authority proposal in this app has been (ADR-0007/0010): it
would hand one peer control over another's content, a bigger authority than
anything else a captain holds.

## Decision — 3: anonymization — strip `teamName`, never resolve `taggedPlayerId`, deliberately stricter than the leaderboard's own precedent

`Team.name` is already cross-team-visible via the leaderboard (ADR-0008).
**Decision: a public clip never surfaces `teamName`, or any other
team-identifying field, anywhere in its public serialization.** This is a
deliberately *stricter* rule than the leaderboard's own precedent, argued
explicitly rather than assumed consistent with it: the leaderboard exposes
an abstract, aggregate fact about a team (a points total); this feature
would bind a **real, identifiable child's face and voice** to a specific
real-world team name (which, per this app's own userbase, often literally
encodes a club/location, e.g. "IBK Falken P13"). That combination —
identifiable video + a name that plausibly locates a real group of
children in the real world — is exactly the de-anonymization risk
CLAUDE.md's closed-team-bubble constraint exists to prevent, in a way a
bare points number never was. The public-feed query, correspondingly,
**never joins `Team` at all** — the structural mirror-image of ADR-0008's
leaderboard, which joins `Team` deliberately; here the join simply doesn't
exist, so there's no field for a future contributor to accidentally add.

**`taggedPlayerId` (ADR-0010's "tag a teammate to challenge them" field) is
never resolved or shown on the public serialization path**, even though it
already exists on the row for the team-feed view. A tag was created under
an assumption of team-only visibility; publishing the clip must not
silently out a *second* child's screen name to a public, cross-team
audience who never separately approved anything. The field stays intact
for the team-feed read (unaffected by this ADR), it's just never included
in the public-feed response shape.

**Residual, stated plainly**: a stranger could still type a team's name
into a reaction/report note, or infer location context from the video
itself (a jersey, a rink's visible signage) — this ADR structurally
prevents the *app itself* from handing that information out, it cannot
prevent every possible inference from the video's own visual content,
matching the same "this defends against routine, in-app observation, not a
determined outside actor" residual framing `docs/adr/0016-cross-team-
leaderboard-fairness.md` already accepted for its own bucketed-count
residual.

## Decision — 4: reactions are a fixed vocabulary, never freeform text — public reporting is new, and auto-revokes public visibility only

### Reactions: fixed vocabulary, not comments — a deliberate scope-narrowing from the open question's own wording

`docs/ACTION_PLAN.md`'s open question 4 poses this as "reactions/comments."
**Decision: reactions only — a small, fixed set of tap-to-react types
(e.g. encouragement-style emoji reactions; exact vocabulary and copy is
ux-designer's call, same "architect fixes the shape, ux-designer fixes the
copy" split ADR-0008/0016 already use for their own deferred button
copy). No freeform text field anywhere on the public feed.** Argued, not
silently assumed:

security-reviewer's own sign-off on ADR-0007's chat filter posture was
**explicitly conditional**: *"acceptable for the current beta specifically
because teams are small, closed, real-world-known rosters... would not
sign off on the same posture at general-availability scale or if teams
ever include players who don't already know each other in person."* A
public, app-wide feed's entire premise is strangers interacting — the
precondition that posture depended on **does not hold at all** here. Reusing
the keyword filter for freeform public comments would be applying
ADR-0007's own already-stated limit past the point its own reviewer said it
stops being acceptable, not a smaller version of the same feature. A fixed,
closed vocabulary sidesteps this entirely by construction — there is no
sentence a fixed reaction type can form, so there's no bullying/grooming
surface to filter in the first place. Freeform public comments between
strangers are **explicitly deferred**, not silently dropped: they would
need a materially stronger moderation approach than this app has ever
shipped (real content moderation, likely the same deferred LLM item
`docs/BACKLOG.md` already tracks for chat, applied to a harder, stranger-
facing context) before being considered, not a reuse of the existing
keyword filter.

```
ClipReaction
  id             uuid, PK
  clip_id        uuid, FK -> video_clip.id, ON DELETE CASCADE
                    -- pure derived engagement data, worthless without the
                       clip, same reasoning as VideoClipTag/
                       ClipPublicationRequest above
  player_id      uuid, FK -> player.id, ON DELETE CASCADE
                    -- personal action, no accountability weight — same
                       category as TeamChatBlock, not ClipReport
  reaction_type  enum (small, fixed set — exact values ux-designer's call)
  created_at     timestamptz
  UNIQUE (clip_id, player_id)
    -- one active reaction per viewer per clip; changing your reaction
       updates the row rather than adding a second one — idempotent
       preference-toggle semantics, the same distinction ADR-0007
       Decision 4 already draws between a block (toggle) and a report
       (accusation, must not be inflatable)
```

Requires the target clip to currently have an **approved**
`ClipPublicationRequest` at write time — the same "must currently be
visible to act on it" structural check this codebase already applies
elsewhere (`assertTeamMembership` for team actions; here, "is this clip
currently public" instead). No moderation-check DI dependency is needed for
reactions at all, since there's no freeform content to check — a
deliberate scope decision, stated explicitly so it isn't mistaken for an
oversight.

**Amendment (security-reviewer, 2026-08-07) — pin the read model, not just
the write model.** This decision specified `ClipReaction` in full detail
and said nothing about what any endpoint returns, which leaves an
Instagram-style "liked by" list as a legal reading of the spec — a
browsable roster of strangers who watched a named child's video, i.e. a
cross-team contact-discovery surface. **No reaction ever discloses who
reacted, to anyone** — not to the uploader, not to other viewers, not in
any admin view. The feed response carries per-type **aggregate counts**
plus a per-viewer `myReaction: <type> | null` derived from the requester's
own row, and nothing else. This is the same shape `ClipFeedItem` already
uses for reports (`reportedByMe: boolean`) and the same guarantee
`ClipReport`'s own entity comment states for its table. Written down here
rather than left to ux-designer because it's a structural property, not a
copy decision.

### Amendment (security-reviewer, 2026-08-07) — blocking works on the public feed too, reusing the existing table

The original decision never mentioned blocking. On the app's most
stranger-exposed surface, a child receiving unwanted repeated reactions
from one stranger would have had only "unpublish everything" or "report" —
and reporting is an *accusation*, not a preference toggle, a distinction
ADR-0007 Decision 4 draws deliberately and this ADR cites approvingly two
paragraphs up. `docs/legal/code-of-conduct-DRAFT.md:70-75` already
promises children they can block someone "any time, for any reason."

**Adopted: reuse `team_chat_block`.** A proposal for a new
`PublicFeedBlock` entity was rejected as a duplicate — verified, that
table has **no team column at all** (`blocker_player_id`,
`blocked_player_id`, `created_at`, and nothing else,
`team-chat-block.entity.ts:23-34`); it is a pure per-viewer
player-to-player mute whose team-scopedness lives entirely in the surfaces
that query it, and it is *already* reused outside team chat by the clip
feed (`video-clips.service.ts:564-571`) and by chat clip attachments.
Decision 8's query gains the same `NOT EXISTS` predicate `listClips`
already has, and reactions from a blocked player are refused. If the name
grates once it serves a fourth surface, rename the table to `player_block`
in a small additive migration — a cosmetic change, not a new entity.

Blocking stays **unidirectional and silent**, exactly as ADR-0007 Decision
4 specified and as it is already implemented — bidirectional suppression
was proposed and rejected here as a new semantic that would change an
already-reviewed mechanism on three other surfaces as a side effect of
this ADR. If it turns out to be genuinely wanted for a stranger-facing
feed, it should be argued on its own merits and applied only in the
public-feed query.

### Reporting a public clip: new `reportSource`, auto-revokes public visibility only — never the team-level `hidden` status

A stranger encountering a public clip needs the same real, immediate
remedy ADR-0010 Decision 4 already gives a teammate. **Decision: extend the
existing `ClipReport` table with a `report_source` enum (`team` / `public`)
rather than build a second report pipeline.** A `public`-sourced report:

- Requires the clip to currently have an `approved` `ClipPublicationRequest`
  (not team membership — the reporter may be on any team, or, going
  forward, none the app currently models differently).
- **Immediately sets `ClipPublicationRequest.status = revoked`,
  `revoked_reason = 'reported'`** — the clip disappears from the public
  feed right away, mirroring ADR-0010 Decision 4's own reasoning
  (structurally can't verify a claim about who's in a clip; a false-negative
  — a child's video staying visible to a wider audience they didn't want —
  is a bigger, more ongoing harm than a false-positive taking a harmless
  clip down).
- **Deliberately does NOT set `VideoClip.status = 'hidden'`** — team-level
  visibility is completely unaffected. Argued, not silently narrower than
  team-side reporting: a stranger's report is specifically about
  *broader-audience appropriateness*, a judgment a person who already
  knows the child in person (every existing teammate, per this app's
  team-membership model) hasn't independently made. Auto-hiding from the
  uploader's own trusted team on an unverified stranger's say-so would be a
  bigger, less-justified intervention than the harm being addressed.
- The existing best-effort, rate-limited emails to the uploader's parent
  and team coach (ADR-0010 Decision 4) fire exactly as today, extended with
  the new `reportSource` in their content — the accountability chain is
  unchanged, and remains this feature's actual mitigation for a human
  noticing a genuinely bad clip, not a fix.

**Residual, stated plainly, not papered over**: if a public report catches
something that's *actually* a problem (not just "not for a wide audience"),
that clip stays visible to the uploader's own team unless a human
separately notices and uses the existing out-of-band admin action (unchanged
from ADR-0010) to set `VideoClip.status = 'hidden'` team-wide. This ADR
does not close that gap automatically — doing so would mean one stranger's
unverified report can suppress content for an entire team that already
trusts each other, a bigger authority shift than this feature should make
silently. Flagged explicitly, same honesty ADR-0007/0010 already model for
their own residual gaps.

Rate-limiting and `(clip_id, reporter_player_id)` uniqueness are unchanged,
extended automatically to public reporters the same way — no new mechanism.

**Amendment (security-reviewer, 2026-08-07) — three corrections to this
subsection, one of them defeating its own remedy.**

1. **The team→public direction was never specified, and it inverts the
   app's strongest safety signal.** This decision reasoned carefully about
   what a *public* report does to *team* visibility and said nothing about
   the reverse. `VideoClipsService.reportClip` sets
   `VideoClip.status = HIDDEN` (`:835-838`) and never touches
   `ClipPublicationRequest` — so a report from a teammate, i.e. from
   someone who actually knows the child in person and is the most credible
   reporter this app has, would hide the clip from that team while leaving
   it visible to every stranger in the app. **Fix: a team-sourced report
   must, in the same transaction, set any active `ClipPublicationRequest`
   to `revoked` / `revoked_reason = 'reported'`.** This is defence in
   depth alongside — not instead of — the read-time `clip.status`
   predicate added in Decision 8.
2. **Report→revoke was defeatable in one round trip.** The partial unique
   index covers only `pending_review`/`approved`, so a `revoked` row does
   not block a fresh publish-request; and
   `UQ_clip_report_clip_reporter` (`clip-report.entity.ts:32-34`, with an
   explicit `ClipAlreadyReportedException` pre-check at
   `video-clips.service.ts:799-804`) then bars the original reporter from
   ever reporting that clip again. Net: report → revoked → uploader
   re-requests → approved → the reporter has **no remedy left at all**.
   Worth being precise about where this bites hardest: for an under-13
   uploader, re-publishing still needs a parent to open a fresh email, so
   it's a slow loop; for the **13+ self-verification cohort, where the
   approver is the uploader**, it is literally one round trip. **Fix, one
   predicate, no new table**: `POST .../publish-request` refuses with
   `409 publish_blocked_previously_reported` if any historical row for
   this `clip_id` carries `revoked_reason = 'reported'`. Lifting that is
   an out-of-band admin action, the same escalation path ADR-0010
   Decision 4 already relies on.
3. **"No new mechanism" overstated it.** `reportClip`'s gate chain is
   `assertTeamMembership(requesterId, teamId)` against a URL-supplied
   `teamId` (`:785-794`, on `@Controller('api/v1/teams/:teamId/clips')`)
   and it unconditionally auto-hides — both wrong for a public reporter.
   Public reporting is a **new service method and route in the new
   `public-feed/` module** (which the Consequences section already
   anticipated); only the `ClipReport` *table* and its rate limits are
   shared. Wording fix, not a design change.

Griefing in the other direction is adequately bounded and needs nothing
new — verified `CLIP_REPORT_COOLDOWN_SECONDS = 30` per reporter and
`CLIP_REPORT_NOTIFY_COOLDOWN_SECONDS = 24h` per uploader
(`redis.service.ts:193-199`) already cap report-spam and the
notification-email amplification it would otherwise cause.

## Decision — 5: retention and takedown — un-publish is immediate/unconditional; public-visibility state has no independent lifecycle of its own

**Un-publish (self-service or report-triggered) must be immediate and
unconditional, exactly matching self-delete's existing guarantee.**
Decided above in Decision 1's `unpublish` endpoint and Decision 4's
report-triggered revoke — both apply the same "even with open reports,
right now, no exceptions" rule ADR-0010 Decision 5 already sets for
deleting a clip entirely.

**No separate retention timer for public visibility.** `ClipPublicationRequest`
cascades from `VideoClip` (Decision 1's "Why CASCADE" above) — when the
underlying clip is hard-deleted for any existing reason (the 90-day rolling
retention sweep, uploader self-delete, or ADR-0013's account-erasure walk),
its publication record, and therefore its public visibility, disappears
with it automatically. This deliberately introduces **no new numeric
config value** (no separate "how long can a clip stay public" cap) — the
clip's own existing lifecycle is the only clock that matters, the same
"boring, reuse what exists" property `docs/adr/0018-ai-video-content-
tagging.md` already achieved for `VideoClipTag`.

**Correction (security-reviewer, 2026-08-07): that claim holds only for
`published` clips, and the gap is a live bug in already-shipped code.**
`ClipRetentionService.sweepExpiredPublishedClips`
(`clip-retention.service.ts:64-69`) selects `status: PUBLISHED` only, and
the hourly sweep only `PENDING_UPLOAD` — so a clip that has ever been
team-reported into `hidden` is **never** reached by retention at all: its
row and its MinIO object persist past 90 days indefinitely, reachable only
by uploader self-delete or account erasure. That contradicts
`docs/legal/terms-of-service-DRAFT.md`'s own retention promise
independently of this feature, and it is what would have made a
publicly-visible hidden clip public *forever* rather than merely
wrongly. **This is an ADR-0010 bug, not an ADR-0019 one — filed separately
in `docs/internal/BACKLOG.md`** (fix: widen the daily sweep to
`status IN ('published','hidden')`). This ADR's own protection against it
is structural and does not depend on that fix landing: the read-time
`clip.status = 'published'` predicate added in Decisions 6 and 8, plus the
team-report→revoke transaction added in Decision 4.

## Decision — 6: the Archive — `SavedClip` is the only new entity; "team's clips"/"my clips" reuse the existing team feed unchanged

The request describes three distinct collections, not two, once
disambiguated against what already exists:

1. **"Your team's clips"** and **2. "clips you personally own"** — both
   are **already fully modeled** by ADR-0010's existing `VideoClip`
   team-scoped feed. (1) is that feed, unfiltered; (2) is the same feed
   filtered to `uploaderPlayerId === me` (a query parameter, e.g.
   `?mine=true`, or a client-side filter — implementation detail, not a
   new entity). **No new backend model is introduced for either** — this is
   deliberately boring, and correct: these are UI-level views over data
   that already exists, unchanged, with ADR-0010's structural team-scoping
   completely intact.
3. **"Saved-for-inspiration"** — genuinely new: bookmarking *other
   players'* public clips. This is the one real gap, and gets its own
   reusable model:

```
SavedClip
  id          uuid, PK
  player_id   uuid, FK -> player.id, ON DELETE CASCADE
                 -- personal bookmark, no accountability weight, same
                    category as TeamChatBlock/ClipReaction above
  clip_id     uuid, FK -> video_clip.id, ON DELETE CASCADE
  created_at  timestamptz
  UNIQUE (player_id, clip_id)
```

**Considered and rejected: a generic, polymorphic bookmark table** (e.g.
`{ playerId, targetType, targetId }`) for future reuse beyond clips.
Rejected as premature generalization — exactly one bookmarkable entity type
exists today, and this schema's own precedent (`ClipReport`,
`TeamChatMessageReport` — per-entity, not polymorphic) is to build the
narrow thing that's actually needed, not the general one that might be. If
a second bookmarkable entity type is ever added, this is a small,
reviewable, additive change then — not scope to pre-build now.

Saving requires the target clip to currently have an `approved`
`ClipPublicationRequest` (can't bookmark something you were never shown).
**Reading the archive must re-validate this at fetch time, every time —
never trust the stored bookmark row alone.** This is the same
"never-trust-a-cached-grant, always re-check current state" structural bar
ADR-0010 Decision 2 already set for clip playback itself ("a presigned URL
is minted fresh per request... never generated once and cached"): if the
original uploader later un-publishes or the clip is deleted/expired, a
`SavedClip` row referencing it must never become a back door to content
that's no longer public. Concretely: `GET .../saved` joins live against
the current `ClipPublicationRequest.status`, and a saved reference whose
source is no longer `approved` is either omitted or shown as "no longer
available" — never served. This is a server-side, structural requirement,
not a client-side courtesy the mobile app could get wrong.

**Amendment (security-reviewer, 2026-08-07)**: that re-validation must
join on **both** `ClipPublicationRequest.status = 'approved'` **and**
`clip.status = 'published'` — as originally written it would still have
served a clip whose own team had reported it into `hidden`. Same predicate
added to Decision 8's feed query and to the react/save/report write-time
checks; see Decision 5's correction for why the `clip.status` half is
load-bearing rather than redundant.

## Decision — 7: interaction with ADR-0013 (account erasure) — free cleanup, zero new per-entity treatment

Because all three new tables (`ClipPublicationRequest`, `ClipReaction`,
`SavedClip`) cascade-delete from either `VideoClip` or `Player` (never
"outlive" pattern like `ClipReport`), every scenario this ADR needs to
answer is already covered by existing FKs, with no new code path:

- **The uploader erases their whole account.** ADR-0013 Decision 6 already
  hard-deletes their `VideoClip` rows (MinIO object, then row). This new
  `ClipPublicationRequest` cascades away with the clip automatically — no
  new row needed in ADR-0013's per-entity table.
- **A player who merely reacted to or saved someone else's clip erases
  their account.** Their `ClipReaction`/`SavedClip` rows cascade from
  `Player`'s own deletion (`ON DELETE CASCADE`), the identical treatment
  ADR-0013 already gives `TeamChatBlock` — personal preference data, no
  accountability weight, gone with the rest of their content.
- **A public clip is hard-deleted for any reason** (retention sweep,
  self-delete, erasure) while other players have saved/reacted to it —
  their `SavedClip`/`ClipReaction` rows cascade away too, silently, the
  same "safe to lose" posture this whole family of tables already shares.

**No new row is needed in ADR-0013 Decision 6's per-entity table for any
of this ADR's three new entities** — this is exactly the "reuse what
already exists" property `docs/adr/0018-ai-video-content-tagging.md`
already achieved for `VideoClipTag`, now demonstrated twice.

## Decision — 8: query/infra shape — no new Redis structure, no Team join, minimal Player join, plain keyset pagination

The public feed query, mirroring ADR-0008's own "boring, this scale doesn't
need it yet" reasoning:

```sql
SELECT
  clip.id, clip.duration_seconds, clip.created_at,
  player.screen_name, player.avatar_id,
  cpr.decided_at AS "publishedAt"
FROM clip_publication_request cpr
JOIN video_clip clip ON clip.id = cpr.clip_id
JOIN player ON player.id = clip.uploader_player_id
WHERE cpr.status = 'approved'
  AND clip.status = 'published'          -- amended 2026-08-07, Decision 5
  AND NOT EXISTS (                       -- amended 2026-08-07, Decision 4
        SELECT 1 FROM team_chat_block b
        WHERE b.blocker_player_id = :viewerId
          AND b.blocked_player_id = clip.uploader_player_id)
ORDER BY cpr.decided_at DESC, clip.id DESC   -- keyset pagination cursor
LIMIT :limit
```

**Amended 2026-08-07 (security-reviewer), three changes to this query**,
each argued where it belongs rather than here: the `clip.status` predicate
(Decision 5's correction — without it a team-reported clip stays public
and, given a live retention bug, forever); the `team_chat_block` `NOT
EXISTS` (Decision 4's blocking amendment, the identical clause
`VideoClipsService.listClips:564-571` already applies); and — not visible
in the SQL, because it belongs in the service — the **viewer-side
`parentalConsentStatus`/`teamJoinStatus` gates** this decision originally
omitted entirely (Decision 2's amendment). The response shape carries
per-type aggregate reaction counts plus the viewer's own `myReaction`, and
never who reacted (Decision 4's read-model amendment).

**Confirmed sound as originally written**: the ordering/pagination itself
leaks nothing — `decided_at DESC, clip.id DESC` exposes only values
already in the response body, and there is no total/count that would
reveal non-visible rows.

**One thing to settle before implementing**: `caption` is absent from the
SELECT list above. If that omission is deliberate, say so explicitly; if
it was an oversight, note that captions are screened by the ADR-0007
keyword filter, whose own sign-off was scoped to "small, closed,
real-world-known rosters" — the precondition Decision 4 correctly refuses
to stretch for reactions. Publishing a caption cross-team inherits exactly
that limit, so the safe default is to keep captions off the public
serialization.

This structurally **never joins `Team`** (Decision 3) and joins `Player`
**only** for `screen_name`/`avatar_id` — the identical shape the existing
team clip feed already uses to render an uploader's identity, not a new
leak surface. No `PlayerPrivateInfo` anywhere in this path.

**No new Redis structure** — plain Postgres keyset pagination
(`decided_at`/`id`) handles an endless-scroll feed comfortably at this
project's actual current scale (the same "a handful of teams" capacity
assumption every other ADR in this codebase already relies on). If public
clip volume or feed-polling frequency ever makes this measurable post-beta,
the existing Postgres-then-Redis pattern (ADR-0002) is the obvious next
step — not built preemptively, same posture ADR-0008/0016 already took for
their own cross-team queries.

## Decision — 9: explicitly deferred or out of scope — not silently dropped, not contradicted

- **The BACKLOG points-tier/multiplier formula** (`docs/BACKLOG.md`,
  "Points system needs a verification/inspiration tier") — this ADR builds
  the publish/approve mechanics that formula would eventually consume, but
  awards **zero** extra points for any publish state. That's a distinct,
  future architect-level change to ADR-0005's formula, flagged there as
  needing its own security-reviewer/ux-designer pass on the peer-pressure-
  to-publish dynamic a points incentive would create — not decided or
  contradicted here.
- **`VideoClipTag` (ADR-0018) staying player-invisible.** This ADR's public
  feed response never surfaces tags, consistent with ADR-0018 Decision 4's
  own explicit "internal-only, this phase" call — not reopened here.
- **Freeform public comments** — deferred per Decision 4, not built.
- **A second/third parent-contact field, or a new "child email"
  credential** — deferred per Decision 1, not built.
- **Reminder emails during the review-code window** (e.g. a day-4 nudge if
  a parent hasn't acted) — a plausible nice-to-have, same "flag, don't
  silently build or drop" posture ADR-0006/0013 already use for their own
  optional notification ideas. Not designed here.
- **Screenshot / screen-record re-upload of a public clip** — added
  2026-08-07 by the security-reviewer pass, promoted from silence to a
  named residual because this ADR did not discuss it at all. Nothing
  structurally prevents a viewer re-capturing another child's public clip
  and publishing it as their own; their own parent would approve it having
  no idea whose child is actually on screen, and the original child can't
  unpublish it (uploader-only, correctly) and would only find out by
  scrolling past it. The existing remedy —
  `ClipReportReason.APPEARS_WITHOUT_CONSENT` — is the right one but
  depends entirely on the victim happening to see it. **One mitigation is
  in scope and must not be dropped silently**: the parent/self review
  page's copy has to ask explicitly whether everyone visible in the clip
  is on the uploader's own team and has agreed to appear — the reviewer is
  the only human in the loop who can catch this, so it is a real
  ux-designer requirement, not decoration. Platform capture-blocking
  (Android `FLAG_SECURE`, iOS capture detection) was **considered and
  rejected**: it is defeated by a second camera, iOS only detects after
  the fact, and shipping it would invite a "we prevent screenshots" claim
  this app cannot honour — the opposite of the honest-residual posture
  ADR-0010/0016 already model.

## Consequences

- **New tables**: `ClipPublicationRequest`, `ClipReaction`, `SavedClip`.
  **New column**: `clip_report.report_source` (enum, additive, defaults to
  `'team'` for all existing rows — every report filed before this feature
  existed was necessarily team-sourced). No changes to `VideoClip` itself.
  **Amended 2026-08-07**: `ClipPublicationRequest` also carries
  `revoke_code` (non-expiring, minted at approval — Decision 1), and
  `revoked_reason` gains `recipient_withdrawn`. Still no `VideoClip`
  schema change, and still no new entity for blocking — `team_chat_block`
  is reused as-is (Decision 4).
- **New modules** (backend-developer's exact wiring, not fixed here):
  `clip-publication/` (owns `ClipPublicationRequest`, the review/approve/
  decline flow, the new unauthenticated video-preview surface) and
  `public-feed/` (owns `ClipReaction`, `SavedClip`, the feed/react/save/
  report endpoints) — mirroring this codebase's existing pattern of
  narrow, single-concern modules (`profile/`, `account-erasure/`,
  `moderation/`) rather than folding this into `video-clips/` wholesale.
- **`PlayerPrivateInfoService.getParentContact`/`hasPendingContactChange`
  gain another legitimate caller** (`clip-publication/`), joining the
  now-several already-tracked callers (consent, session-reissue, team-chat,
  video-clips, account-erasure) — flagged explicitly, same posture every
  prior widening of this boundary already got, for security-reviewer to
  confirm this new caller still can't reach `real_name` or any other field
  through this path.
- **Mandatory, blocking prerequisite: fix the consent-copy claim** ("only
  visible to their own team") **before or alongside shipping this
  feature** — an existing, live, false-the-moment-this-ships promise every
  current family already relied on. This is not scoped as a Decision 3-
  style optional transparency note (contrast ADR-0018 Decision 3's "not a
  new gate, just better disclosure") — it is a correction to an existing
  false claim, the same severity class as ADR-0018's own "no photos"
  finding, and should be treated as blocking by security-reviewer the same
  way that one was.
  **Scope corrected 2026-08-07 by the security-reviewer pass — this ADR
  originally named one file; the promise is live in six surfaces**,
  verified by grepping the whole tree the same way ADR-0018's own fix was
  verified:
  1. `backend/src/consent/consent-page.templates.ts` — **16 strings, not
     8**: all 8 locales of `CONSENT_CONFIRM_COPY` *and* all 8 of
     `SELF_VERIFICATION_CONFIRM_COPY` (the 13+ cohort's own copy block,
     which this ADR overlooked entirely and which is precisely the cohort
     whose self-approval path Decision 1 flags as its hardest question).
  2. `mobile/src/i18n/locales/*/clips.json` → `v0.bullet1` — **all 8
     locales**: *"Only your own team can see the Shorts videos uploaded
     here."* This is the **Shorts feature's own in-app explainer, shown to
     the child**, and is the single most direct contradiction of the six.
  3. `docs/legal/terms-of-service-DRAFT.md` — §1.1's "never public, never
     cross-team", the §1.2 data table's "Video clips | Never shown outside
     that one team" row, and §5.
  4. `docs/legal/code-of-conduct-DRAFT.md` — §5's "Only your own verified
     team can ever see what you post here", and the entry under **"What's
     structurally true, not just promised"**. That heading is the sharpest
     of the six: it is the register in which stale copy stops being stale
     copy and becomes a misrepresentation.
  5. `site/index.html` — the "Slutna lagbubblor" trust card, *"Inget syns
     utanför ditt eget verifierade lag — **som standard, inte som
     inställning**"*. The bolded half is the marketing claim this feature
     most directly falsifies.
  6. `docs/PROJECT.md`'s Privacy-by-Design section and
     `docs/design/phase3-flows.md`.
- **Blocking prerequisite the project owner alone can close: amend
  CLAUDE.md's closed-team-bubble non-negotiable.** Added 2026-08-07. The
  constraint currently reads *"a user only ever sees their own verified
  team"*, and CLAUDE.md directs every agent in this repo to push back on
  anything weakening it — so this ADR cannot self-certify past it, however
  well-argued the crack is. The owner amends that sentence themselves
  (e.g. adding *"…except for individual clips the uploader has published
  through ADR-0019's per-clip approval gate"*) or this feature does not
  ship. See the Status section.
- **Open, flagged rather than answered: whether correcting the copy
  forward is legally sufficient, or whether existing families need a real
  re-consent event.** Every current family consented under an explicit,
  unqualified "never public, never cross-team" representation. Whether
  those consents remain valid once the representation changes — or whether
  each family must be re-notified and given an affirmative opportunity to
  object *before* any of their child's clips can be published — is a
  GDPR/consumer-law question, not an engineering one. This ADR's
  fix-the-copy prerequisite is necessary; neither pass could confirm it is
  sufficient. Note the cheap belt-and-braces answer if the real legal read
  is slow: the per-clip gate means no existing clip becomes public without
  a *fresh* parent approval anyway, so the practical exposure of getting
  this wrong is bounded — but that is an argument for proceeding
  carefully, not for skipping the question.
- **One genuinely new class of attack surface**: the unauthenticated,
  code-gated video-preview page (Decision 1) — this app's first time
  serving real child video outside both team-membership and session
  authentication. Named explicitly, not glossed over, as the single item
  most deserving of hard scrutiny in the required security-reviewer pass.
- **One judgment call flagged as not purely technical**: whether the 13+
  self-verification cohort's self-approval path for publishing (Decision 1)
  is a sound extension of ADR-0002's existing Art. 8 reasoning, or needs a
  different answer — this ADR picked a default, built to be easy to
  tighten later, but does not consider the underlying policy question
  closed.
  **Security-reviewer's plain answer, 2026-08-07, since this ADR asked for
  one**: routing the review email to the player's own address defends
  against a borrowed or compromised session, **and against nothing else**.
  It is a genuine control against exactly one threat — someone holding the
  phone but not the inbox. It is not a second party, not an independent
  judgment, and not a cooling-off period: the same child who tapped
  publish clicks a link in their own inbox, usually within seconds, on the
  same device. This ADR's Context calls the new gate *"materially stronger
  than anything else in this app has ever required"* — accurate for the
  under-13 cohort, **overstated for the 13+ cohort**, where it is a
  device-possession check in the clothes of a two-party gate. Whether that
  suffices for "consenting to make my own face visible to a cross-team
  stranger audience" — a different question from the account-creation-and-
  ordinary-processing one ADR-0002's reversal actually answered — needs
  the project owner and, plausibly, a real legal read. **If the answer
  comes back "not sufficient," the cheapest structural fallback needs no
  schema change**: a mandatory cooling-off delay for this cohort between
  request and the link becoming actionable — the same shape ADR-0012's 24h
  contact-change grace period already uses for exactly this "a live
  session alone must not be enough" reason. Stated here so that outcome is
  a config change rather than a redesign.
- **No schema change to `VideoClip`, `Team`, or any existing entity** —
  every new table is additive; every existing team-scoped read path
  (ADR-0010) is untouched byte-for-byte.
- Hand-off, per this project's standing division of labor: **ux-designer**
  designs the endless-scroll feed, reaction UX, the review-page copy (the
  parent/self-approval screen genuinely needs careful, plain-language
  copy given what it's asking someone to judge), and the Archive tab
  layout, against this ADR directly. **security-reviewer**'s blocking pass
  happens next, per this ADR's own Status section, before either
  ux-designer finalizes flows that assume unreviewed endpoints or
  backend-developer writes a single migration.
  **Updated 2026-08-07**: that blocking pass has now run (see the Status
  section). ux-designer and backend-developer may proceed **against this
  ADR as amended**, subject to the two hard gates that are not theirs to
  close — the project owner's CLAUDE.md amendment, and the copy
  corrections across all six surfaces listed above. ux-designer
  additionally owns two requirements the pass added that are flow
  constraints rather than styling choices: the review page must ask
  whether everyone visible in the clip is on the uploader's own team and
  has agreed to appear (Decision 9's screenshot residual), and it is a
  two-step reveal — metadata first, video only after an explicit tap
  (Decision 1's prefetch amendment). backend-developer should read
  `backend/src/pt/pt-consent.service.ts` before writing anything: it is
  the shipped, already-reviewed implementation of this exact state
  machine, and several amendments above are simply "match what it already
  does."
