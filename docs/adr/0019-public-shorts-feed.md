# 0019 - Public opt-in Shorts feed, reactions & personal archive (Fas 6)

## Status

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
                                    already reuses
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
  revoked_reason               enum, nullable: owner_unpublished / reported
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
ORDER BY cpr.decided_at DESC, clip.id DESC   -- keyset pagination cursor
LIMIT :limit
```

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

## Consequences

- **New tables**: `ClipPublicationRequest`, `ClipReaction`, `SavedClip`.
  **New column**: `clip_report.report_source` (enum, additive, defaults to
  `'team'` for all existing rows — every report filed before this feature
  existed was necessarily team-sourced). No changes to `VideoClip` itself.
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
- **Mandatory, blocking prerequisite: fix the 8-locale consent-copy claim**
  ("only visible to their own team") **before or alongside shipping this
  feature** — an existing, live, false-the-moment-this-ships promise every
  current family already relied on. This is not scoped as a Decision 3-
  style optional transparency note (contrast ADR-0018 Decision 3's "not a
  new gate, just better disclosure") — it is a correction to an existing
  false claim, the same severity class as ADR-0018's own "no photos"
  finding, and should be treated as blocking by security-reviewer the same
  way that one was.
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
