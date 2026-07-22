# 0010 - Video clip storage, access scoping, and retention (Fas 3)

## Status

Accepted — 2026-07-22. **Blocking security-reviewer sign-off required before
backend-developer builds against this**, per CLAUDE.md's standing rule and
per `docs/ACTION_PLAN.md`'s explicit Phase 3 sequencing ("security-reviewer:
sign off on the storage/access design *before* backend-developer builds it,
not after"). This is the highest child-privacy-risk feature built in this
app so far — real video of real children, not text or a duration/count
field — and this ADR treats it that way throughout, not as "team chat with
a file attached."

## Context

`docs/PROJECT.md`'s original pitch: "En intern, säker feed där spelare kan
ladda upp 15-sekundersklipp på när de klarar en fint, ett skott eller en
fysövning. De kan också 'taga' en lagkompis och utmana dem." — an internal,
closed, team-only short-clip feed, plus tagging a teammate to challenge
them. `docs/ACTION_PLAN.md`'s Phase 3 checklist asks this ADR to decide
three things: where clips physically live given this project's *actual*
infra (not an assumed cloud vendor), how access is scoped so a clip is only
ever reachable by the uploader's own verified team — structurally, the same
bar ADR-0008 set for the leaderboard query — and a retention/deletion
policy covering GDPR erasure and roster changes.

**Infra reality check, load-bearing for Decision 1:** per `k8s/README.md`
and `temp/HANDOFF.md`, the actual deployment target is `oidc@isstech-2`, a
**shared internal PaaS cluster** (`paas.safedc.net`, OpenStack-based), not a
specific cloud vendor's blessed stack. `type: LoadBalancer` doesn't work
here (the CCM has `service-lb-controller` disabled), external ingress is
still being stood up, Postgres/Redis both already run as single-replica
Deployments with a Postgres PVC and no object-storage service anywhere in
this repo. Nothing in this codebase or the k8s manifests assumes AWS
S3/GCS/Azure Blob are available, and there is no evidence this specific PaaS
tenancy has managed object storage (e.g. Swift) provisioned or reachable —
this ADR does not assume it. Designing around a specific cloud vendor's
object storage API being trivially available would be exactly the kind of
premature, infra-mismatched design CLAUDE.md warns against.

## Decision — 1: clips live in a self-hosted, S3-API object store inside the cluster

**Deploy MinIO** (self-hosted, S3-API-compatible object storage) as a new
pod in the `skillstreak` namespace — a `Deployment` + `PersistentVolumeClaim`
+ `ClusterIP Service`, **the exact same shape this repo already uses for
Postgres** (`postgres-deployment.yaml`/`postgres-pvc.yaml`/
`postgres-service.yaml`). No new deployment paradigm, no new PaaS
capability required beyond what Postgres already proves works on this
cluster (a ReadWriteOnce PVC bound to a single-replica stateful pod).

Why this over the alternatives, for *this* project at *this* phase:

- **Not AWS S3/GCS/Azure Blob directly** — nothing in this ADR should be
  read as "assume a specific vendor's object storage is available," per the
  infra reality above. If this project ever moves off the shared PaaS onto
  a cloud vendor with real managed object storage, that's a config change
  (endpoint/credentials), not an app rewrite, *because* the app only ever
  speaks the S3 API — this is the actual portability benefit, not a
  vendor-neutrality slogan.
- **Not video bytes in Postgres** (`bytea`/large objects) — wrong tool.
  ADR-0002 already establishes Postgres as "durable structured source of
  truth," not a blob store; multi-megabyte video rows would bloat every
  backup/restore and WAL, for no benefit over a purpose-built object store.
- **Not raw filesystem storage on the API pod's own PVC** — would tie video
  bytes to the API Deployment's own lifecycle/scaling story (already
  constrained to `replicas: 1` for an unrelated migration-race reason, per
  `k8s/README.md`) and mixes "the app's code" with "a growing pile of
  child video" in one volume. A dedicated pod with its own PVC keeps that
  boundary clean and matches how Postgres already gets its own volume.
- **Not a hosted managed video/media SaaS** (Cloudinary, Mux, etc.) — an
  external third party would receive real, identifiable video of children
  by default, for a project whose entire privacy posture is "closed team
  bubbles, nothing leaves this app." Introducing a new external processor of
  child data is a decision with real GDPR/DPA weight (a new sub-processor)
  that this ADR isn't going to make silently for a pre-MVP phase. If a
  managed service is ever genuinely warranted (e.g. real transcoding needs
  at scale), that's a future, explicitly-flagged decision — not this one.

This is the "boring, easy to change" option for this specific infra: one
more stateful pod of a kind this repo already runs and already knows how to
operate (PVC provisioning, `ClusterIP`-only exposure, no ingress), speaking
a well-understood, swappable API.

### Bucket/key layout

One bucket (`clips`), never publicly readable (no bucket policy grants
anonymous/public access — see Decision 2 for why this matters more than the
key layout). Object keys are **server-generated, never client-supplied**:
`clips/{teamId}/{clipId}.{ext}`. The `{teamId}` prefix is an **organizational
convenience** (bulk-cleanup-by-team, readable-at-a-glance in an admin
listing) — **not** the security boundary. Nothing about a private bucket
enforces per-prefix access control by itself; Decision 2 is what actually
does that.

## Decision — 2: access is scoped structurally, not by convention — mirrors ADR-0008's join-avoidance bar

ADR-0008 set the bar for this app's cross-boundary data: the leaderboard
query is **structurally incapable** of returning `Player` data because
`Player` is never joined, not because a developer remembered to filter it
out. This ADR sets the equivalent bar for video: **a clip's bytes are
structurally unreachable by anyone outside the uploader's own team**,
enforced by two independent layers, not one:

1. **The bucket itself has zero public/anonymous read access.** There is no
   bucket policy, no public prefix, nothing reachable by a bare URL. The
   *only* way to read an object's bytes is a presigned GET URL, and the
   *only* thing holding the credentials able to mint one is the backend API
   service. This is the same shape as `postgres-service.yaml`/
   `redis-service.yaml` already being `ClusterIP`-only with no
   external-facing path — MinIO's `Service` gets the identical treatment
   (never an Ingress, never `NodePort`/`LoadBalancer`).
2. **The backend only ever mints a presigned URL after a Postgres check that
   the requesting player's `teamId` matches the clip's `team_id`** — the
   same `assertTeamMembership`/`team_mismatch` check every other team-scoped
   endpoint in this app already performs (chat, weekly goals, roster). This
   check happens on **every single read** (a presigned URL is minted fresh
   per request, short-lived — see below — never generated once and cached
   or returned from a second, unscoped path).

Concretely: `VideoClipsService` never accepts a bare `clipId` from a route
without first loading that clip's row and checking `clip.teamId ===
requestingPlayer.teamId`, exactly mirroring how `TeamPoolService`'s
leaderboard query never joins `Player` — there is no code path in this
design that can serve a clip's bytes without that check running first, the
same "structural, not a code-review reminder" bar ADR-0008 already
established for this codebase.

**Presigned URLs (both directions) are short-lived**: a presigned PUT for
upload expires in ~5 minutes (long enough for a slow mobile upload of a
~15-20 second clip, short enough to bound a leaked URL's usefulness);
a presigned GET for playback expires in a similarly short window (recommend
5-10 minutes — backend-developer's exact call) and is **minted fresh on
every feed fetch**, never persisted or reused across requests. This bounds,
but doesn't eliminate, the residual risk that a legitimately-issued URL
could be copy-pasted outside the app during its short validity window — the
same residual risk any authenticated media URL has; stated plainly as a
known, bounded, not-fully-closed gap, the same way ADR-0007 states its own
residual risks rather than implying zero risk.

### Upload is two-phase (presigned PUT), not proxied through the API

`POST .../clips/upload-url` → client PUTs bytes directly to MinIO → `POST
.../clips/:clipId/complete` confirms. This is the ordinary way to talk to
an S3-API store (not "impressive," just how the protocol is meant to be
used) and, as a real side benefit, keeps raw video bytes from ever flowing
through the single-replica API pod's own request/response cycle. See the
API contract doc for the exact shapes.

## Decision — 3: "clip validity" is a deterministic check, not ML — and no local ML service is warranted this phase

The task asks this ADR to decide whether the tagging feature or any
clip-validity check actually needs local ML. **Decision: no.**

**"Tag a teammate to challenge them" needs zero ML.** Per `docs/PROJECT.md`'s
own wording, tagging references another player's account (a `taggedPlayerId`
FK, validated as a teammate) so they get challenged/notified — it is not a
claim about who physically appears on camera in the clip. This is the exact
same shape as `blockedPlayerId` on `TeamChatBlock` or `challengeId` on
`TrainingLogEntry` — an ordinary foreign-key reference, not a
computer-vision problem.

**"Clip validity" splits into two genuinely different questions, and only
one is in scope now:**

- **Technical validity** ("is this actually a short, playable video file
  within our size/format limits") — a **deterministic** check: allow-listed
  MIME types (`video/mp4`, `video/quicktime`, `video/webm`), a hard cap on
  duration (recommend ~20s, matching the pitch's "15-sekundersklipp" plus a
  small buffer) and file size (recommend ~25MB, generous for that length at
  reasonable mobile-capture quality), spot-checked at the `complete` step
  against the object's actual reported size/content-type from MinIO (a HEAD
  request), not deeply re-encoded or frame-inspected. This needs no ML —
  it's the same class of check `class-validator` DTOs already do for every
  other input in this app, just against object-storage metadata instead of
  a request body.
- **Content validity** ("does this video actually show floorball
  training and not something inappropriate/unrelated") — this **would**
  need real ML (video classification) to automate. **Decision: not built
  this phase**, for the same reasoning ADR-0007 gave for deferring
  LLM-based chat moderation, applied to video: this project's teams are
  small, closed, real-world-known rosters (the same condition
  security-reviewer explicitly required for ADR-0007's keyword-filter
  posture to be acceptable) — building a video-classification pipeline (a
  new Python/uv service, model hosting, a sync-vs-async latency tradeoff, a
  false-positive/false-negative cost model for children's content) is real,
  non-trivial infrastructure this phase doesn't have evidence it needs yet.
  Decision 4 below (auto-hide-on-report) is this phase's actual mitigation
  for bad content reaching the feed — a human-in-the-loop safety net, not a
  preventative filter, the same trade this app already makes for chat text.

**Consequence for ADR-0003's package-manager convention:** no Python
service is introduced by this ADR. `uv` remains the standing convention
*whenever* a Python service is eventually built (this or the deferred
LLM-chat-moderation item are the two most likely triggers) — nothing here
obsoletes that decision, it's just not exercised yet. A short backlog entry
is added (`docs/BACKLOG.md`) so this "not now, not never" call is visible
the same way the LLM-chat-moderation deferral already is, not silently
dropped.

## Decision — 4: reporting a clip auto-hides it — a deliberate divergence from ADR-0007's chat precedent

`TeamChatMessageReport` (ADR-0007) explicitly does **not** hide a message —
that ADR gives real reasons (a peer shouldn't get unilateral censorship
power over another child's speech; a false-positive hide costs a
conversation its context in the moment). **This ADR makes the opposite call
for video, deliberately, not by copying the chat precedent without
reconsidering it:**

**A single report immediately sets the clip's `status` to `hidden`**,
removing it from the team feed for everyone, pending the same best-effort
human follow-up chat already uses (see below). Reasoning for the asymmetry:

- **Video is not time-sensitive conversational context.** Hiding a clip
  costs nothing analogous to "silencing a reply someone needed to see right
  now" — the uploader can dispute it out of band, or re-upload if the hide
  turns out to be a mistake, with no urgency lost.
- **This app has no computer-vision check on who appears in a clip
  (Decision 3).** That means the backend structurally cannot verify a
  report's claim ("I'm in this and didn't agree to be") before acting on
  it — the honest, cautious answer when you can't verify a claim about a
  child's own image is to act on it provisionally, not require proof first.
- **The harm asymmetry runs the other way for video than for text.** A
  false-positive hide (a harmless clip wrongly taken down) is a minor,
  recoverable inconvenience. A false-negative (a clip showing a child who
  didn't want to be filmed staying visible to the whole team) is ongoing,
  compounding exposure of a child's actual likeness — a categorically
  bigger harm than a single rude message staying visible for a few extra
  hours. That trade-off is different enough from chat's that this ADR
  reaches a different conclusion, not an inconsistent one.

**Still not unilateral peer authority over the *team*, only over *this one
clip's default visibility, provisionally***: the uploader cannot self-reverse
a hide (would defeat the point of a report), and no in-app actor — not the
reporter, not a captain — can *permanently* restore or delete on their own
authority; un-hiding is the same out-of-band admin action ADR-0007 already
uses for chat (a backend-developer script/manual DB action, same posture as
this codebase's existing seed/admin-only actions). A captain gets **no**
special power here either, consistent with ADR-0007's explicit rejection of
captain-triggered team-wide hiding for chat — captaincy stays "a flagged
peer with logistics duties," not a content-moderation authority, in both
features alike.

To prevent this stronger-than-chat auto-hide effect from becoming a
harassment tool in its own right (report a teammate's clip maliciously to
make it vanish), the same per-reporter rate limit and `(clip_id,
reporter_id)` uniqueness ADR-0007 uses for chat reports applies here too —
see the API contract.

**The gap this does not close, stated plainly (same posture as ADR-0007's
own admission):** auto-hide bounds *visibility* fast, but there is still no
reliable, timely human review that confirms a hide was warranted, reverses a
bad one, or takes any further action against genuinely inappropriate
content beyond "it's no longer shown." The best-effort emails below are a
real mitigation, not a fix — the same honest framing ADR-0007 already gives
its own report path, extended here rather than re-argued from scratch.

### What a report does, concretely

1. Persists a `ClipReport` row (append-only, same shape/rationale as
   `TeamChatMessageReport`).
2. Sets `VideoClip.status = 'hidden'` immediately (the divergence above).
3. **Best-effort, rate-limited email**, identical mechanism to ADR-0007
   Decision 3 (reuses `MailService`'s existing best-effort pattern, reuses
   `PlayerPrivateInfoService.getParentContact` as a **third** legitimate
   caller — see the module-boundary note below — and the dormant
   `TeamCoach`/`Coach.email` lookup), to:
   - the **uploader's own parent** (accountability chain for their child's
     upload), and
   - the **team's coach**, if one is on file.
   Both rate-limited to at most one email per uploader per rolling 24
   hours, aggregating multiple reports in that window — the same
   already-fixed shape from the Phase 2.5 consent-reminder finding, not
   the original burst-only version.
4. **Never returns `ClipReport` rows to any client** — only a
   `reportedByMe: boolean` per clip, identical anonymity guarantee to
   ADR-0007 Decision 1.

### Module-boundary note — extends ADR-0002/ADR-0007's widening

`PlayerPrivateInfoService.getParentContact` already has two legitimate
callers (the consent flow, and `team-chat/`'s report path, per ADR-0007).
This ADR adds a **third**: the new `video-clips/` (or similarly named)
module, for the identical narrow purpose (one player's contact, on a real
report event). Flagged explicitly, same as ADR-0007 flagged its own
widening, so a future contributor doesn't lose track of who's allowed to
call this and why — security-reviewer should confirm this module still
can't reach `real_name` or any other field through this path (it can't;
`getParentContact` only ever returns `parent_contact`).

## Decision — 5: retention and deletion

Video of a real, identifiable child is a materially heavier data category
than anything else this app stores — a training-log count or a chat message
has no equivalent "this is what my kid looks like, currently reachable by
their whole team" property. This phase treats retention as a first-class
decision, not an afterthought.

### Default: clips are ephemeral by design — a fixed rolling retention window, hard-deleted

**Recommendation: 90 days from upload**, after which a clip (object bytes
**and** its Postgres row) is deleted automatically, unconditionally — no
"pin this forever" feature exists or is being built here. This is a
deliberate, explicit product-policy number, not an architecturally rigid
one: it's a config value (e.g. `CLIP_RETENTION_DAYS`), not hardcoded logic,
and the project owner/ux-designer should feel free to tune it (shorter,
e.g. 30 days, would push this feature closer to true TikTok-style
ephemerality; the mechanism below doesn't care which number is chosen).
**Flagged, not silently decided as final**: the exact number is a product
call this ADR recommends but doesn't consider closed.

Why a fixed rolling window rather than "delete at end of season" (which
would mirror `Season`'s existing half-year boundary): ADR-0008 already
flagged that `Season`/`TeamSeasonPot` date ranges aren't guaranteed
consistent across teams (an accepted, explicitly-tracked limitation) —
tying video retention to that same inconsistent boundary would import a
known gap into a second feature for no benefit. A fixed per-clip window is
simpler, uniform across every team regardless of season-setup quirks, and
"boring" in exactly the sense CLAUDE.md asks for.

**Mechanism**: `VideoClip.expires_at` is set at publish time
(`createdAt + retentionWindow`). A daily in-process scheduled task (e.g.
`@nestjs/schedule`'s `@Cron`, inside the existing API service — **not** a
new Kubernetes `CronJob`/separate infra piece) finds expired rows, deletes
each object from MinIO first, then deletes the Postgres row only after that
succeeds (if object deletion fails transiently, the row is left for the
next run rather than deleting the row and permanently orphaning the object
— the safer failure direction, since an orphaned object nobody can ever
reach again is harmless waste, while a row with no confirmed-deleted object
is a live task item, not a solved one). This mirrors this codebase's
existing "opportunistic in-process action over a new cron/K8s primitive"
precedent (ADR-0005's goal-bonus check runs inside the training-log
transaction rather than a separate job, for the same "boring, no new infra"
reasoning). **Inherits the existing `replicas: 1` constraint** documented in
`k8s/README.md` (the migration-race fix) — if the API is ever scaled beyond
one replica, this sweep needs the same kind of single-runner guard that gap
already requires solving (a Postgres advisory lock, or designating one
replica), not a new problem invented here.

### Self-service delete: the uploader can remove their own clip immediately, any time

`DELETE .../clips/:clipId`, uploader-only (no captain/coach override — same
"no peer authority over another's content" posture as chat). Hard-deletes
object + row immediately, unconditionally, even if the clip has open
reports — real self-determination over your own upload, consistent with how
every other write in this app treats the acting player as the authority
over their own data. This is also, in practice, **this phase's actual
answer to "please take this video down"** — the single most likely
real-world request from a parent — without requiring a broader
account-erasure feature that doesn't exist yet (see below).

### Report-driven hide (Decision 4) vs. deletion — these are different states

A `hidden` clip is **not** deleted — it's provisionally suppressed pending
human follow-up, and its bytes still exist so an out-of-band admin review
can actually look at what was reported before deciding anything permanent.
Only expiry, self-delete, or a genuine erasure action (below) hard-deletes.

### `ClipReport` outlives the clip it reported — same pattern as `ParentalConsentRecord`'s durability

Because a report's audit trail matters independently of whatever later
happens to the clip (self-delete, expiry), `ClipReport.clip_id` is
**nullable, `ON DELETE SET NULL`**, and `ClipReport` **denormalizes
`reported_uploader_player_id`** at write time (the same `team_id`-on-
`TrainingLogEntry` denormalization pattern ADR-0002 already establishes) —
so the accountability record ("this player was reported, for this reason,
on this date") survives the clip's own deletion, exactly as intended; only
the video bytes and the clip's own row disappear.

### Player leaves/is removed from the team

`VideoClip.team_id` is **denormalized at upload time**, the identical
pattern ADR-0002 already gives `TrainingLogEntry.team_id` and ADR-0007 gives
`TeamChatMessage.team_id`: a clip belongs, permanently, to the team it was
posted to at the moment of upload — **not** derived from the uploader's
*current* `Player.team_id`. So if a player later transfers teams or is
otherwise no longer active on that roster, their existing clips stay
exactly where they were shared, visible to that team, unaffected — the same
answer this codebase already gives for training logs and chat history.
`uploader_player_id` stays `ON DELETE RESTRICT` (same precedent as
`Challenge.created_by_player_id`/`TeamChatMessage.sender_player_id`) —
there is no "delete a player row while keeping their content" concept
anywhere in this app yet, and this ADR doesn't invent one.

### GDPR erasure of an entire player account — a known, inherited gap, now with real teeth

**This app has no self-service or even admin-scripted full account-deletion
feature today** — ADR-0009 already flagged "permanently-orphaned
self-created teams if consent is never approved" as an accepted gap under
this app's existing no-deletion posture. Phase 3 doesn't invent that gap,
but it materially raises its stakes: a training-log count carries far less
weight under a genuine erasure request than an actual video of a child.

**Decision, scoped to what this phase can responsibly ship**: full
account-level erasure remains **out of scope for this ADR** (consistent
with CLAUDE.md's "build for the phase in front of us," and there's no
existing mechanism to hang it off yet) — but self-service clip deletion
(above) already covers the single most likely real request ("take down
this video of my child") completely, immediately, without needing the
larger unbuilt feature. **Flagged explicitly for security-reviewer and the
project owner**: if/when a parent ever requests deletion of an *entire
account* (not just a clip), that request currently has to be fulfilled the
same manual, out-of-band way every other admin-only action in this app is
(a backend-developer script) — and whoever performs it must remember to
hard-delete that player's `VideoClip` rows/objects as part of it, not just
the `Player` row, since leaving videos up while deleting the profile that
made them would defeat the point of the request. This ADR doesn't build
that script, but says plainly what it must do to that data if/when it's
written.

## Consequences

- One new stateful service in the cluster (MinIO), matching Postgres's
  existing Deployment+PVC+ClusterIP shape — new `k8s/` manifests needed
  (`minio-deployment.yaml`, `minio-pvc.yaml`, `minio-service.yaml`, new
  Secret entries for MinIO credentials in `secret.yaml.example`) —
  hand-off to backend-developer, not written here.
- New Postgres entities: `VideoClip`, `ClipReport` — see the API contract
  doc for exact field lists matching this ADR's decisions.
- No Redis structure added for the feed itself, same "boring, this scale
  doesn't need it yet" reasoning ADR-0008 gives the leaderboard — Redis is
  used only for the existing rate-limit-cooldown pattern (upload frequency,
  report frequency), reusing infrastructure that already exists.
- No Python/ML service introduced (Decision 3) — `docs/BACKLOG.md` gains a
  short entry for deferred video content moderation, mirroring the existing
  LLM-chat-moderation entry, so this "not now" is visible, not silently
  dropped.
- **Reading the feed is gated on parental consent, not just uploading** — a
  deliberate divergence from ADR-0007's "chat-read is ungated" precedent,
  reasoned through in the API contract doc's conventions section: video of
  real children is a big enough step up in sensitivity from text that this
  ADR chooses the stricter default rather than mechanically reusing the
  looser one, for the single highest-privacy-risk phase built so far.
- **Left open, not decided here** — flagged for ux-designer/
  backend-developer: should an existing `TeamChatBlock` (a per-viewer mute
  of a teammate's chat messages) also suppress that same teammate's clips
  in the video feed, or are these two independent per-viewer preferences?
  No product requirement was stated either way; this ADR doesn't invent a
  new `ClipBlock` entity on spec, but doesn't rule one out either.
- **Left open, not decided here** — exact numeric caps (retention-window
  days, max clip duration/file size, presigned-URL expiry windows,
  upload/report rate-limit numbers) are all recommended above with
  reasoning, but are genuinely tunable config values, not schema decisions
  — ux-designer/backend-developer/the project owner should feel free to
  adjust them without needing a new ADR, as long as the *mechanisms*
  (deterministic validity checks, structural team-scoping, auto-hide on
  report, fixed-window hard deletion) stay intact.
- See `docs/api/phase3-contract.md` for the full endpoint contract
  (request/response shapes, error codes, exact field lists) backend-
  developer and frontend-developer build against directly.
