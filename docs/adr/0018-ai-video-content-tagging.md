# 0018 - AI content tagging for video clips (Fas 4)

## Status

Proposed — 2026-08-01. **Blocking security-reviewer sign-off required
before backend-developer builds anything against this**, same standing
rule CLAUDE.md sets for every feature touching media or child data, and
the same precedent ADR-0007 (team chat) and ADR-0010 (video storage)
already followed: a first security-reviewer pass returned required
changes, not a rubber stamp, on both of those. This ADR should get no
lighter a review than ADR-0010 did — it's an addition *on top of*
ADR-0010's already-highest-risk feature, not a separate, smaller one.

## Context

Raised by the project owner directly, verbatim (`docs/BACKLOG.md`, two
entries): a 2026-07-26 entry asking for AI to "understand each uploaded
video's content and auto-tag it," and a more informal 2026-07-31 note
("AI Tagging of Video") floating an LLM plus a "RAG database" to
"identify the correct sport and what it could be used for and many other
taggs... for easier to recommend to our audiance." Both are raw intake,
not a spec — this ADR is the requested architect pass the first entry
itself already called for.

**Scope check, confirmed before anything else**: this app has no photo
upload today. `docs/adr/0010-video-storage-and-serving.md` and the
current `video-clips` module (`backend/src/video-clips/`) only ever
accept `video/mp4`, `video/quicktime`, `video/webm`
(`CLIP_MIME_TYPES`/`CLIP_MIME_TYPE_EXTENSIONS` in
`video-clip.constants.ts`) — there is no `image/*` path anywhere in the
entity, DTOs, or storage layer. `docs/BACKLOG.md`'s separate "verification
tier" entry proposes a *future* "photo uploaded as proof" points tier, but
that's an unbuilt product idea, not existing scope — this ADR covers
tagging of the video clips this app actually has, and doesn't invent
photo-upload support to fit the request's "video/photo" phrasing.

Three existing pieces of this codebase bear directly on this decision and
are treated as load-bearing, not just background:

1. **ADR-0010 Decision 1** already rejected sending clip video to any
   third-party media SaaS, for exactly the reason this ADR has to weigh
   again for tagging: "an external third party would receive real,
   identifiable video of children by default... a decision with real
   GDPR/DPA weight this ADR isn't going to make silently."
2. **ADR-0010 Decision 3** deliberately deferred automated *content*
   validity checking (does a clip actually show training) as needing
   real ML this app didn't have evidence it needed yet, and named the
   mitigation instead (report-driven auto-hide, Decision 4) as this
   phase's human-in-the-loop answer. This ADR does not silently reopen
   that call — see Decision 1 below for how the two relate without
   contradicting each other.
3. **CLAUDE.md itself already names the likely trigger for a first Python
   service**: "`uv` for any future Python service (e.g. a video-tagging
   service)." This is that service, if this ADR recommends self-hosting —
   not a new precedent to invent, a dormant one to actually use.

Also relevant, not decided here: `docs/BACKLOG.md`'s "verification
tier"/points-formula entry flags "video-verified needs a real definition"
and explicitly names this tagging item as one candidate way to give that
tier real teeth (confirming a clip's content roughly matches the claimed
activity, rather than "any upload = verified"). This ADR does not touch
the points formula — that's its own flagged, unresolved product decision
— but Decision 1 below is written so its output is *usable* as an input
to that future work, not incompatible with it.

## Decision — 1: scope — what "correct tags" means, concretely

Three candidate use cases exist for "AI understands the video":

- **(A) Activity/drill-type classification** — what kind of training a
  clip shows (e.g. shooting, stickhandling, fitness/conditioning,
  goalkeeping, team drill), for future badge/challenge matching and as an
  input signal to the still-undecided "video-verified" points tier.
- **(B) A coarse moderation signal** — "does this look like training
  content at all," as an additional signal alongside the existing
  report-driven auto-hide (ADR-0010 Decision 4), *not* a replacement for
  it.
- **(C) A searchable/discovery tag for a future public feed** — the
  motivating idea behind the informal "recommend to our audience" note,
  and behind Fas 6's not-yet-designed public Shorts feed
  (`docs/ACTION_PLAN.md`, "Phase 6").

**Decision: build (A) first, as a single fixed-vocabulary tag per clip,
and treat (B) as a free, non-authoritative byproduct of the same
classification — not a separate system.** Reasoning:

- (A) is the only one of the three with a concrete, already-identified
  consumer inside this app *today*: a future `BadgeAward` `triggerReason`
  variant (the same discriminated-union extension point ADR-0002's
  addendum already documents — "a future badge trigger needs its variant
  added to this map") and the verification-tier backlog item. It's the
  most literal reading of "tag what's in the clip," and the smallest
  scope that's still genuinely useful.
- (B) is real, but this ADR treats it strictly as a *side effect* of (A)'s
  output, not a new moderation system: a classifier that can say "this is
  a shooting drill" can, as the same operation, produce "this doesn't
  look like any of the fixed training categories" — that low-confidence/
  no-match case is exactly the coarse moderation signal, at zero
  additional design cost. Building a dedicated, separate
  content-moderation pipeline would silently reopen ADR-0010 Decision 3's
  deliberate deferral (small, closed, real-world-known rosters; human
  report + auto-hide is this phase's accepted mitigation) — this ADR
  doesn't do that. Any such signal stays internal and advisory (feeds a
  coach/admin review queue at most, in a later phase) — it must never
  auto-hide a clip on its own; only a human report does that, unchanged
  from ADR-0010 Decision 4.
- **(C) is explicitly deferred, not designed here.** Fas 6's public feed
  doesn't exist yet, has its own open, security-reviewer-gated questions
  (per-clip parental approval, anonymization stripping, cross-team
  exposure) that this ADR isn't going to pre-empt, and a cross-team
  *searchable* index of children's video content would need its own
  privacy pass regardless of how tags are generated. If Fas 6 is ever
  designed, it can reuse the same tag vocabulary/data this ADR produces —
  see Decision 4's visibility note — but that reuse is a future decision,
  not this one.
- **The "RAG database" idea from the informal note is not adopted.**
  Retrieval-augmented generation implies freeform, LLM-generated tags/
  descriptions and a vector index over children's video content — the
  opposite of this codebase's standing instinct (`BadgeAward.context`,
  `PlayerLocale`) that anything derived and machine-generated about a
  child gets a **fixed, allow-listed vocabulary**, not open text, per
  Decision 4 below. A fixed-category classifier does everything (A) and
  (B) need without it. If a genuine recommendation/discovery feature is
  ever scoped (that's a Fas 6/personalization idea, not a tagging one),
  it should get its own ADR rather than being folded into this one.

## Decision — 2: self-hosted, server-side classification — not on-device, not a third-party API

"AI identifier" means sending video (or extracted frames) to *some*
classification model. Three real categories, weighed for this project
specifically:

- **On-device (mobile).** Strongest privacy property in the abstract (no
  bytes leave the phone for this purpose) — but a poor structural fit
  here. ADR-0010's upload path is two-phase and presigned specifically so
  raw video *never* flows through the API's own request/response cycle;
  bytes go client → MinIO directly. On-device tagging would mean
  building and shipping a model inside the Expo app itself (a native
  module, real binary size and battery/compute cost on children's own
  phones, no consistent capability across a real device fleet — old
  Android hardware included), can't retroactively tag anything already
  uploaded, and every model update ships through app-store review instead
  of a server deploy. Rejected for this phase, not forever.
- **Third-party AI vision API** (Anthropic/OpenAI/Google Vision/AWS
  Rekognition/etc.). The fastest to build — no model hosting, no ops. But
  it means sending real, identifiable video of children (post-remux, so
  no GPS metadata, but still each child's face/voice/likeness) to an
  external company, for the first time in this app's history in this
  form. This is a **new sub-processor relationship**, categorically
  different from anything this app currently sends outward, and directly
  the thing ADR-0010 Decision 1 already refused for storage, for the same
  underlying reason. It needs: a real DPA with whichever vendor, an
  update to whatever privacy disclosure/policy this app has for parents,
  a check on whether that vendor's terms even permit processing children's
  data at this app's target ages, and vendor lock-in on a data type this
  app should be minimizing exposure of, not maximizing. **Not recommended
  as the default** — stated in full per CLAUDE.md's explicit instruction
  to treat this as the highest-risk option, only worth it if the project
  owner explicitly decides the speed-to-ship is worth taking on a new
  sub-processor, with eyes open, as its own follow-up decision.
- **Self-hosted, server-side model — recommended.** The video already
  lives in this app's own MinIO instance the moment upload completes
  (ADR-0010 Decision 1) — a self-hosted classifier reading from that same
  bucket adds **zero new places the data goes**; it's a natural extension
  of "clips live in infrastructure this app already controls," not a new
  data-sharing surface. It matches ADR-0010 Decision 1's own reasoning for
  rejecting a hosted media SaaS, applied to the tagging step the same way.
  It's also the trigger CLAUDE.md itself already anticipated ("`uv` for
  any future Python service, e.g. a video-tagging service") — a new
  Python service (`uv`-managed, per ADR-0003), deployed the same
  Deployment+PVC-for-model-weights shape this repo already uses for
  Postgres/MinIO, is boring infrastructure this project already knows how
  to run, not a new paradigm.

**Named, not hidden**: this is real, non-trivial compute/ops cost this
project doesn't have today — a model to select and host, CPU (or GPU, if
warranted) inference capacity, a new pod, a queue/async job runner. That
cost is stated plainly, not waved away by calling it "boring" — it's the
honest trade against the third-party option's speed. **Exact model/vendor
selection (which open-weights model, which inference runtime) is
explicitly not decided here** — a real follow-up decision, once this
architecture category is accepted, likely by backend-developer with
architect input given the tooling implications.

**Performance note, addressing the informal note's "test vs. production
performance" concern**: because Decision 5 makes tagging strictly
non-blocking and asynchronous (never in the request/upload path), its
latency is not user-facing — a clip is playable and published immediately
regardless of whether tagging has run yet. This removes most of the
practical force behind "production needs to be faster" — the job can run
in seconds-to-minutes without a player ever noticing, on modest,
single-instance CPU inference, at this app's current clip volume.

## Decision — 3: consent — an internal-processing disclosure update, not a new consent gate (for the recommended architecture)

CLAUDE.md requires parental approval "before any account can upload
video/media." The existing consent copy
(`consent-request-email.template.ts`) is a broad, account-level approval
("start logging training sessions and see the team's shared points") —
it doesn't itemize specific internal processing steps today (it doesn't,
for instance, separately mention that uploaded video gets a metadata-
stripping remux per ADR-0010 Decision 3 either).

**For the recommended self-hosted architecture**: analyzing a clip with a
model running inside this app's own infrastructure is the same category
of "how this app processes video you've already approved uploading" as
the remux step already is — no new party receives the data, no new
purpose beyond enrichment of content already inside the closed team
bubble. **Decision: this does not need a new consent *gate*** — the
existing upload-consent approval already covers it in substance — **but
the consent/privacy-disclosure copy should be updated** to name, in plain
terms, that uploaded clips may be automatically analyzed to generate
tags, for transparency's sake (GDPR's "specific and informed" consent
expectation is better served by naming this than by silence, even where
a new *gate* isn't strictly required). This is a copy change
(ux-designer/backend-developer), not a new schema/flow.

**If the third-party option were ever chosen instead** (not recommended,
Decision 2): that would need its own, separate, explicit disclosure and
almost certainly its own consent gate, not an extension of the existing
copy — the same "new use needs new consent, not implied consent" question
`docs/ACTION_PLAN.md`'s Phase 6 planning already flagged for
publishing a minor's video to a wider audience. Sending a child's video to
an external company is a materially different act than storing it in this
app's own bucket, and should never be silently folded into "they already
approved media upload."

## Decision — 4: data model — a fixed-vocabulary tag table, cascade-deleted with its clip, internal-only for now

**A new table, `VideoClipTag`**, not a new freeform column on `VideoClip`
— consistent with this schema's existing normalized pattern (`ClipReport`
is its own table, not embedded JSON), and because a clip can plausibly
carry zero-to-several tags, not exactly one:

- `id`, `clip_id` (FK → `VideoClip.id`, **`ON DELETE CASCADE`** — see
  below for why this differs from `ClipReport`'s pattern), `tag` (a fixed
  Postgres enum — exact vocabulary is a product/backend-developer
  refinement, not decided here in detail, but the *shape* follows
  `PlayerLocale` (ADR-0014) and `BadgeAward.context.triggerReason`
  (ADR-0002 addendum): a small, closed, allow-listed set, e.g. something
  like `shooting`, `stickhandling`, `passing`, `fitness_conditioning`,
  `goalkeeping`, `team_drill`, `other_training`, `unclear_or_unrelated` —
  never freeform AI output persisted directly), `confidence` (numeric),
  `source` (e.g. `'auto_tagger_v1'`, so a future model version is
  distinguishable from today's — matters if/when re-tagging or model
  upgrades happen), `created_at`. Only tags above some confidence
  threshold get persisted at all — a clip with no tag rows simply has "no
  confident tags," a normal, expected state, not an error (see Decision 5
  for how that's distinguished from "not tagged yet").
- **Why `ON DELETE CASCADE`, deliberately different from `ClipReport`'s
  nullable/survives-the-clip pattern (ADR-0010 Decision 5)**: `ClipReport`
  outlives its clip because it's an accountability record about a
  *person's action* (a report was filed, on this date, for this reason)
  that matters independently of the video. A tag has no such independent
  value — it's pure derived enrichment *about the video's content*, worth
  nothing once the video is gone. Cascading it is the correct precedent
  to follow here, not `ClipReport`'s — stated explicitly so a future
  contributor doesn't copy the wrong one by analogy.
- **Visibility: internal-only, this phase.** Tags are never returned in
  any player-facing API response and never rendered in the Shorts feed UI
  — they exist for backend consumers only (a future badge-award job, a
  future coach/admin review queue, or Fas 6's eventual tag-reuse, if that
  gets designed). This is the minimal, boring default: it sidesteps
  needing i18n'd tag copy, avoids a new visible-to-teammates data surface
  on top of an already-sensitive entity, and doesn't commit to Fas 6's
  still-undesigned public-feed tag exposure. Making tags player-visible
  later is a small, additive follow-up if a real use case needs it — not
  precluded, just not built now.

**Consequence for the erasure/retention chain already documented**:
because `VideoClipTag` cascades from `VideoClip`, every existing deletion
path that already deletes a `VideoClip` row — the 90-day retention sweep,
uploader self-delete, and the account-erasure walk (ADR-0013's
`VideoClip` row in its per-table erasure table) — automatically takes its
tags with it, with **no new code path to write or remember**. This is
exactly the "reuse what already exists" property this ADR should have,
not a new thing to get wrong.

## Decision — 5: non-blocking, best-effort enrichment — never a new upload/publish gate

Tagging must never become a second gate alongside ADR-0010 Decision 3's
deterministic validity checks. Concretely:

- **Upload and publish are entirely unaffected.** A clip becomes
  `published` exactly as it does today (technical validity check +
  mandatory metadata-strip remux, ADR-0010 Decision 3) — tagging is not in
  that critical path at all, structurally, not just "usually fast enough
  not to matter."
- **A new `VideoClip.tagging_status` column** (`not_processed` [default],
  `tagged`, `no_confident_tags`, `failed`) tracks the job's outcome
  without ever affecting playback, feed visibility, or any user-facing
  state. A background job (the same "in-process `@nestjs/schedule`, no
  new Kubernetes primitive" pattern ADR-0010 Decision 5 already
  established for the retention/`pending_upload` sweeps — or, if the
  self-hosted model runs as its own service per Decision 2, an internal
  queue between the two, backend-developer's call on the exact
  mechanism) picks up `published` clips with `tagging_status =
  'not_processed'`, calls the classifier, and writes the outcome. Only
  `status = 'published'` clips are ever targeted — a `pending_upload` or
  already-`hidden` clip is not queued.
- **Failure is silent to the user, always.** If classification errors,
  times out, or the tagging service is unreachable, `tagging_status`
  becomes `failed` and the clip is otherwise untouched — still played,
  still in the feed, still deletable/reportable exactly as normal. A
  bounded retry (e.g. the next sweep run picks up `failed` rows again, up
  to some small retry cap so a permanently-broken file doesn't loop
  forever) is a reasonable refinement, exact policy left to
  backend-developer.
- **Retention, restated plainly**: no orphaned tag data can outlive its
  clip (Decision 4's cascade), and no failed/incomplete tagging attempt
  blocks or delays anything a player or parent can already do with a clip
  today.

## Consequences

- **New Postgres**: `VideoClipTag` table, `VideoClip.tagging_status`
  column — both additive migrations, no change to any existing
  ADR-0010 entity/behavior.
- **New infra, if Decision 2 is accepted**: a self-hosted Python/`uv`
  service (or in-process library, if a sufficiently lightweight model
  allows — backend-developer's call) for classification, exercising
  ADR-0003's dormant Python-package-manager convention for the first
  time. Real, named ops cost (hosting, model selection/updates) — not
  free, not hidden.
- **No change to `docs/BACKLOG.md`'s deferred video-content-moderation
  item** (ADR-0010 Decision 3) — this ADR's coarse "no confident tag
  match" signal is explicitly advisory only and does not resolve or
  replace that deferred, harder problem; `docs/BACKLOG.md` should be
  updated to note this ADR's relationship to that entry once accepted,
  not to mark it done.
- **Left open, not decided here**: exact tag vocabulary (illustrative
  only above), exact model/vendor choice within the self-hosted category,
  and whether/how tags eventually surface in Fas 6's public feed — all
  real follow-up decisions once this ADR's architecture category is
  accepted.
- **Hand-off**: this ADR is design-only. **A blocking security-reviewer
  pass is required before backend-developer builds anything against it**
  — specifically to re-check the third-party-API rejection reasoning in
  Decision 2, confirm the consent-copy conclusion in Decision 3, and
  confirm the cascade-deletion reasoning in Decision 4 closes the same
  kind of gap security-reviewer already caught twice in ADR-0010 (the
  metadata-stripping and `pending_upload`-TTL findings) — this feature
  has the same "new derived data about a child's video" shape that made
  those findings necessary the first time. ux-designer should be looped
  in for the consent-copy update named in Decision 3. frontend-developer
  has no work from this ADR directly (tags are internal-only, Decision 4)
  unless/until a later ADR makes them player-visible.
