# skillstreak-gpu — video analysis and tagging architecture

Written 2026-08-11. This is the design for **ADR-0018's missing half**: the
service and job that populate the `video_clip_tag` table and drive
`video_clip.tagging_status`, both of which have been in the schema since
migration `1785800000000` with nothing consuming them.

It is a design document, not an ADR. Several decisions below **amend
ADR-0028** (its Phase 1/Phase 2 sequencing, its single `AI_INFERENCE_*`
config pair, and its instruction that Phase 2 must raise the auth bar to
mutual TLS). Those amendments are argued in place and flagged in "Where
this departs from ADR-0028". Once the security review below passes, they
should be folded back into ADR-0028 as an amendment, or split out as
ADR-0030 — not left living only here.

## Status

**Blocking security-reviewer pass required before any of this is built.**
Not a scoped pass — the full weight ADR-0010, ADR-0019 and ADR-0027
received, per ADR-0028 Decision 15's own words: *"Nothing in this section
may be built before a full-weight blocking security-reviewer pass... and
nothing in it may be built before that pass lands."* That sentence is the
governing rule for this document. This design is the input to that pass,
not a substitute for it.

Specifically the reviewer is asked to adjudicate five things this design
takes a position on and could be wrong about:

1. **Decision 1's structural definition of "internal use only"** — is the
   list of shapes that cannot exist actually complete?
2. **Decision 2's sequencing answer** — is a non-child-data fixture stage
   plus a stateless analyser enough to make video-first acceptable on a
   cluster that has never served a request?
3. **Decision 3's refusal to build any safety classifier** — this is what
   makes ADR-0028 15.1's escalation-path precondition satisfiable. If the
   reviewer thinks a training-type classifier implicitly *is* a moderation
   system, this design fails and 15.1 binds in full.
4. **Decision 4's departure from mutual TLS** (ADR-0028 Decision 10 says
   Phase 2 needs it once media crosses). The argument is that under
   Decision 4 no media *reference* crosses and a leaked token buys compute,
   not access to a child's stored video. Accept or reject that explicitly.
5. **Decision 11's acceptance of a derived index over children's video**,
   and the specific controls offered instead of refusing it.

### Preconditions, in order

| # | Precondition | State |
|---|---|---|
| 1 | A network route from the app cluster to `skillstreak-gpu` | **Blocked.** No ingress, no LoadBalancer, no Elastic IP. ADR-0028 Open Question 1, unmoved. |
| 2 | Consent disclosure names automatic clip analysis | **Done, already live.** Verified in `backend/src/consent/consent-page.templates.ts` — both `CONSENT_CONFIRM_COPY` and `SELF_VERIFICATION_CONFIRM_COPY`, all locales, per `docs/design/adr0018-tagging-disclosure-copy.md`. See Decision 3 for why the exact wording constrains scope. |
| 3 | Model chosen against a fixture set, on this hardware | Not started. Decision 6, Stage 0b. |
| 4 | Blocking security review | Not started. |

Precondition 1 blocks everything. Preconditions 2 and 3 do not block each
other and can proceed in parallel with it — Stage 0b (Decision 2) needs
only `kubectl` access to the GPU cluster, not a route from the app.

## Verified facts this design rests on

Read from source on 2026-08-11, not assumed. Where something could not be
verified it says so.

- **The tag vocabulary is already fixed in Postgres**, not a future
  decision. `video_clip_tag_tag_enum` =
  `shooting, stickhandling, passing, fitness_conditioning, goalkeeping,
  team_drill, other_training, unclear_or_unrelated`
  (`1785800000000-AddVideoClipTagging.ts`, mirrored in
  `VideoClipTagValue`). `confidence` is `numeric(4,3)` with a `CHECK
  (confidence >= 0 AND confidence <= 1)`. `source` is a plain `varchar`,
  deliberately not an enum. `clip_id` is `ON DELETE CASCADE`. The only
  index is `IDX_video_clip_tag_clip_id`.
- **`video_clip.tagging_status`** = `not_processed | tagged |
  no_confident_tags | failed`, default `not_processed`, on every existing
  row. The entity comment explicitly invites a supporting index alongside
  whatever job consumes it: *"Not indexed yet... add one (mirroring
  `IDX_video_clip_status_expires_at`'s shape) alongside whatever job is
  built to consume it."*
- **The publish path is synchronous and has exactly one processing step.**
  `VideoClipsService.completeUpload` HEADs, size/type spot-checks, buffers,
  `probe`s, `remuxStripMetadata`s, re-uploads to the same `storage_key`,
  then flips to `PUBLISHED` in one transaction. No queue, no async stage.
- **ffmpeg and ffprobe are already in the API runtime image**
  (`backend/Dockerfile`: `RUN apk add --no-cache ffmpeg`), invoked via
  `execFile` from `VideoProcessingService`. Frame extraction on the app
  side needs no new dependency and no new image.
- **`ObjectStorageService.getObjectBuffer` buffers the whole object into
  memory.** Fine at `complete` (one request, one clip); **not fine** in a
  batch job on a 2-replica pod. Decision 7 forbids reusing it.
- **Production object storage is Safespring S3 at
  `https://s3a4.sto2.safedc.net`** (`k8s/configmap.yaml`), publicly
  reachable, with `MINIO_PUBLIC_ENDPOINT` deliberately unset because that
  one address serves both internal and presigned use. The internal test
  cluster still runs self-hosted in-cluster MinIO, LAN-only. This
  asymmetry matters in Decision 4 and Decision 9.
- **The erasure walk enumerates media exactly one way.**
  `AccountErasureService.executeSingleErasure` finds `VideoClip` by
  `uploaderPlayerId`, `executeTeamCascade` by `teamId`; each then calls
  `deleteObjectIfExists(clip.storageKey)`. One table, one storage key, one
  object store. ADR-0013 Decision 6's per-entity table has one `VideoClip`
  row and no tag row, because tags cascade.
- **Cross-replica job plumbing is generic and extracted.**
  `tryClaimScheduledJobRunOrSkip` (`common/scheduling/`), five-minute
  Redis claim, both failure modes are "skip this tick".
  `ERROR_LOG_JOB_NAMES` is the single vocabulary for job names, shared
  between the Redis lock key and `error_log_entry.job_name`.
- **The admin console has four pillars** (`admin.controller.ts`:
  `usage-metrics`, `errors`, `bug-reports`, `planning/*`), plus
  `admin-environment.util.ts`'s environment badge.
- **The GPU cluster:** 3 workers × (4 vCPU, 8 GB RAM, 1 × NVIDIA A2,
  15 356 MiB VRAM, compute 8.6), Talos, k8s v1.35.4, Cilium, Cinder CSI
  (`fast`/`large`), cert-manager. `runtimeClassName: nvidia` required.
  PodSecurity `restricted` enforced. Namespace `skillstreak-ai` and
  `cluster-identity` ConfigMap applied. No ingress, no LoadBalancer.
- **Nothing of ADR-0028 Phase 1 exists yet** — no `ai/` directory, no
  `AI_INFERENCE_URL` anywhere outside that ADR's own prose. This cluster
  has never served a request of any kind.

**Could not be verified from here:** whether Alpine's `ffmpeg` package in
the API image is built with HTTPS input support (needed for Decision 7's
preferred ranged-read path); the A2's real throughput on any specific
model; whether the app cluster egresses from a stable, allow-listable IP.
Each is named again at its point of use with the fallback.

---

## Decision 1 — "Internal use only", as a structural rule

ADR-0018 Decision 4 says tags are "internal-only, this phase" and lists
what that excludes. That is a policy sentence. This is the version that
can be checked, in the shape ADR-0022 Decision 5 uses ("no field of that
shape exists in the type"). **This decision is the whole risk profile of
the feature; everything else is engineering.**

### Who may see a tag

| Consumer | Sees a tag? | Reasoning |
|---|---|---|
| A player (child) | **Never.** | The obvious one, and the easy one. |
| A captain (also a child) | **Never.** | Captain is an in-app authority, not an adult. A captain seeing a machine's judgement of a teammate's video is a child being handed a tool to rank other children. |
| A tagged teammate, an uploader about their own clip | **Never.** | "Your own data" is the argument that would open this, and it fails: the uploader would then be able to read the machine's opinion of a clip that also contains other children. |
| A PT / trainer (`pt` staff role, ADR-0023) | **Never, in v1.** | Argued below — this is the genuinely tempting one. |
| A coach (email contact only, no login) | **Never.** | No surface exists; do not create one. |
| The operator (`admin` staff role, ADR-0022 console) | **Aggregate only**, plus health/queue numbers. **Never a tag joined to a clip, team, or player.** | Argued below. |

**Why not the PT/trainer.** The pull is real: "show the trainer what kinds
of training their team is actually posting" is a plausible product idea and
PTs are adults with legitimate team links (ADR-0029 Decision 4). It is
refused because a per-team tag breakdown is a machine-derived behavioural
profile of a specific group of named children, and ADR-0022 Decision 5's
closing bullet already named exactly this failure mode in the abstract: a
second table reintroducing a per-team breakdown "through a different table
without ever touching `UsageMetricsService` or this Decision's own
guardrails." A tag table is that different table. If this feature is
wanted later it is a separate ADR with its own review, and it starts from
"what does a trainer do differently because of it" — not from "we have the
data anyway."

**Why the operator gets aggregates and not per-clip rows.** The operator
already holds the database credential and can mint a presigned URL for any
clip; a per-clip admin view therefore adds no *capability*. It adds a
*surface* — a convenient, browsable, filterable list of children's clips
with a machine's label attached, which is a materially different thing from
"could reconstruct it with `psql` if they chose to." The one legitimate
need a per-clip view would serve is evaluating whether the model works;
Decision 2 moves that evaluation onto a fixture set containing no child of
this app, which is where it belongs anyway.

### The rule, stated as shapes that cannot exist

1. **No response type reachable by a player token contains `tag`,
   `tags`, `taggingStatus`, `confidence`, or any derived field of them.**
   Not "the UI doesn't render it" — the field is not in
   `ClipFeedItem`, `PendingChallengeItem`, `CompleteUploadResponse`, or
   any DTO under `video-clips/dto/`, and adding it is a visible,
   reviewable change to those exact files.
2. **`VideoClipTag` is not registered in any controller's response path.**
   The entity's own header comment already says this ("Do not add this
   entity to any response DTO/controller without a new ADR making tags
   player-visible"); this design does not change it.
3. **No query that serves a child joins `video_clip_tag`, and no query
   that serves a child filters or orders on `tagging_status`.** Concretely:
   `VideoClipsService.listClips`'s query builder gains no `leftJoin`, no
   `andWhere` on either, and no `orderBy` derived from either. The feed
   stays chronological. **This is the "tags never filter or rank anything
   a child sees" rule**, and it is enforced in one method.
4. **No badge, no points, no challenge, no notification, no chat message
   may be triggered by a tag.** This closes the loophole where a child
   never sees a tag but sees its shadow. ADR-0018 Decision 1 named a
   future `BadgeAward.triggerReason` variant as tagging's motivating
   consumer; **this design does not build it and recommends against it
   until the model's accuracy on this population is measured** (Decision
   6). A badge is a machine-authored public statement about a child's
   video, and awarding one on an unvalidated classifier is worse than not
   awarding it. Same for ADR-0025's evidence tiers: a tag is not evidence
   that a child trained, and must never become an input to the
   individual-streak state (Redis) or the `TeamSeasonPot` ledger
   (Postgres). Neither side of the scoring model is touched by anything in
   this document.
5. **The admin-facing view type has no `clipId`, `teamId`, `playerId`,
   `storageKey`, `uploaderScreenName`, or free-text field.** Its shape is
   fixed in Decision 8. There is nothing to wire a per-team filter *to*,
   which is the ADR-0022 Decision 5 bar.
6. **The tag distribution shown to the operator carries a minimum-count
   floor**, reusing ADR-0020 Decision 3 / ADR-0022 Decision 5's existing
   bucketing-and-floor logic rather than a second implementation. A
   distribution over a window in which one team posted three clips is a
   description of that team.
7. **Nothing crosses a team boundary.** No cross-team query exists, no
   cross-team surface is created, and tags may not become the mechanism by
   which cross-team browsing arrives. ADR-0019 is blocked on a CLAUDE.md
   amendment only the project owner can make; ADR-0029 Decision 9 refused
   curated cross-team highlights of children's media outright. This design
   does not reopen either, and a tag-driven "clips like this from other
   teams" feature would have to go through ADR-0019's gate, never through
   this one.

**What this leaves the feature actually good for**, stated honestly so
nobody has to guess: in v1, tags are a **latent, internal enrichment** whose
only live consumers are the operator's aggregate view and future features
that do not yet exist. That is a thin return for the work. It is stated
plainly rather than dressed up, because the alternative — inventing a
child-facing consumer to justify the effort — is exactly the pressure this
decision exists to resist.

---

## Decision 2 — The sequencing inversion, answered honestly

ADR-0028 Decision 4 put the training-plan LLM first and said the order *is
the point*: Phase 1 "contains no child data. That is the whole argument. It
proves the cluster, the deployment, the model runtime, the internal API
contract, the cross-cluster auth, the failure behaviour and the admin
visibility — with a workload that structurally cannot leak a child's
anything."

The owner has decided the model workload is video analysis and tagging.
That decision stands and is not re-argued. But the *reasoning* behind
ADR-0028 Decision 4 was never about training plans specifically — it was
about the first request to a new cluster not containing a child. **That
property is recoverable without the training-plan LLM**, and this design
recommends recovering it.

**The honest assessment: video-first is not safe as a straight swap, and
becomes acceptable with one addition.** Going straight to real clips means
children's media crosses a cluster boundary as the very first request ever
served by that cluster — before anyone knows whether the pod restarts under
load, whether the image logs request bodies at some default level, whether
the ingress logs what it is handed, or whether the model returns anything
useful. Every one of those is a normal first-week discovery, and each is a
discovery you want to make against something other than a child's video.

**Recommendation: a fixture stage, inside the video track.** Not a
different workload — the same service, the same endpoint, the same
manifests, the same auth, the same model. Only the input differs.

| Stage | What runs | Child data crosses? | Gate to leave |
|---|---|---|---|
| **0a — route** | Ingress/route exists; the app cluster can `GET /health` on the GPU cluster and gets `{status, serviceVersion, modelId, promptSetVersion}` | No. No model, no data. | `/health` answers from an API pod, and the response's version strings match the image CI built. |
| **0b — fixture eval** | Analyser deployed with the real model. A `uv` script in `ai/clip-tagger/eval/` posts sampled frames from an **operator-supplied fixture set** and prints a confusion matrix over the eight vocabulary values. | **No — this is the point.** Fixtures contain no child who uses this app. | A confusion matrix the owner is willing to act on, a chosen confidence threshold, and measured host-RAM/latency/cold-start numbers (Decision 6). |
| **— review —** | **Blocking security-reviewer pass.** | | Sign-off. |
| **0c — dry run** | The backend sweep runs against real published clips: extracts frames, calls the analyser, writes **nothing** except Redis counters. `CLIP_TAGGING_DRY_RUN=true`. | **Yes** — frames cross. Nothing derived is persisted. | A short, watched window (days, not hours) with no errors and a tag distribution that looks like floorball. |
| **1 — live** | `CLIP_TAGGING_DRY_RUN=false`. Tags persist. | Yes. | — |

Stage 0c is deliberately labelled as crossing the boundary. It is not a
"no child data" stage and calling it one would be exactly the kind of
comfortable mislabelling this project's own review history keeps catching.
Its value is narrower and real: it separates "does the app-side pipeline
work" from "is the derived record correct", so the first durable tag row is
written by a pipeline that has already run a thousand times.

**The fixture set is also the model-selection harness**, which is why this
stage costs almost nothing beyond what Decision 6 requires anyway: you
cannot choose between candidate models without labelled examples, and those
examples must not be children's clips. Concretely, 30–60 short clips of
floorball training the owner records or holds rights to, covering all eight
vocabulary values including deliberate negatives (a clip of nothing, a clip
of a crowd), stored **outside** the `clips` bucket and outside Postgres —
a directory on the operator's machine, and nothing else. They are not app
data and must not become app data.

**What this does not fix, named:** the cluster still has no route, and
Stage 0a is where that blocker actually bites. And a fixture set of adults
playing floorball is not a sample of what nine-year-olds film on a phone in
a badly-lit sports hall; the confusion matrix from Stage 0b will be
optimistic. That is a reason to set the confidence threshold conservatively
and to treat Stage 0c's distribution as the real evidence, not a reason to
skip the fixtures.

---

## Decision 3 — No safety or abuse classifier, in this phase or by accident

**This is a precondition being satisfied by removing the obligation, not
by discharging it.**

ADR-0028 Decision 15.1 is right and its seven questions are unanswerable
today: a classifier that flags possible abuse in children's media creates
duties the moment it fires, this app has no human review queue for
anything, one operator cannot commit to a review SLA, ADR-0010's uploader
self-delete is unconditional and immediate, `ClipRetentionService`
hard-deletes at 90 days, and nobody here can give legal advice on Swedish
reporting obligations. A detector with nowhere to send a hit is worse than
no detector.

**So this design builds no detector.** Specifically:

- **The analyser's only output is a score over the eight already-shipped
  training-type values.** It has no nudity head, no violence head, no
  person-detection head, no age-estimation head, no face detection of any
  kind, and no "is this appropriate" score. There is no field in the
  response that could carry one.
- **`unclear_or_unrelated` is not a safety signal and must never be
  treated as one.** ADR-0018 Decision 1 framed the coarse "this doesn't
  look like training" case as a free byproduct. It is a free byproduct of
  *low model confidence*, which on this hardware and this domain will fire
  on dark clips, blurry clips, clips shot from the ceiling, and clips of a
  goalkeeper standing still. Routing it anywhere that looks like a
  moderation queue would launder a low-information signal into an
  accusation. Decision 5 goes further and refuses to persist it at all.
- **Nothing auto-hides.** ADR-0010 Decision 4's report-driven auto-hide is
  the only mechanism that changes a clip's `status`, unchanged, and it
  requires a human report. No tag, no confidence value, and no analyser
  failure may write `video_clip.status`.

**The consent copy independently constrains this**, which is a stronger
argument than a design preference. The disclosure shipped for ADR-0018
Decision 3 says, in `CONSENT_CONFIRM_COPY`'s Swedish: *"Videoklipp som
${safeName} delar kan också analyseras automatiskt för att skapa taggar
som beskriver vilken typ av träning de visar."* Parents approved automatic
analysis **to generate tags describing what kind of training the clips
show**. Scanning the same clips for suspected abuse is a different purpose
with a different legal basis and a different disclosure, and folding it in
under this sentence would be precisely the "new use needs new consent, not
implied consent" move ADR-0018 Decision 3 already refused for the
third-party path.

**If the owner does want a safety classifier**, it is a separate ADR, a
separate blocking review, a new consent disclosure, and ADR-0028 15.1's
seven questions answered first — starting with the legal advice, which is
the long-lead item and costs nothing to start now.

---

## Decision 4 — What crosses the boundary: sampled JPEG frames, and nothing else

Two real options. This is the load-bearing choice in the whole design,
because it determines the auth bar, the network posture, and whether the
"stateless analyser" rule is enforceable or merely asserted.

### Option A — the API mints a presigned GET; the analyser fetches and decodes

ADR-0028 Decision 3 and 15.5 assume this shape ("short-lived presigned GETs
minted per request by the API, which is the same mechanism ADR-0010 already
uses for playback and requires no new trust").

Honest accounting:

- The analyser needs **egress to the object store**, so "this pod talks to
  nothing" stops being enforceable with a network policy.
- **The storage key crosses.** `clips/{teamId}/{clipId}.mp4` is embedded in
  the URL. So `teamId` and `clipId` cross the boundary by construction,
  in a string that an ingress access log will happily record if it is ever
  a query parameter, and that any proxy in front may record regardless.
- **The full clip crosses, including audio** — children's voices,
  teammates' voices, a coach shouting (see ADR-0027's Context: clips carry
  whatever the phone recorded).
- **A leaked bearer token is now a leaked key to children's video**, not
  just to compute, because an attacker with the token can replay whatever
  the analyser is handed. This is exactly why ADR-0028 Decision 10 said
  Phase 2 must raise the bar to mutual TLS.
- The analyser must decode video, on a node with **8 GB of host RAM** that
  is also staging model weights. The binding constraint fights this option.

### Option B — the API samples frames with ffmpeg and posts the images (recommended)

The API extracts N still frames from the clip and posts those. Nothing
else crosses.

- **No presigned URL, no storage key, no `teamId`, no `clipId`, no
  filename crosses.** The correlation id is a fresh random UUID per
  request, meaningful only inside that request.
- **No audio crosses, ever** (`-an`, explicitly). Children's recorded
  voices never leave the app cluster. Given ADR-0027's F3 finding — a
  child's voice on a team chant being the personal data everyone missed —
  this is not a small property.
- **The analyser needs no egress at all.** It can be denied all outbound
  traffic except DNS by a network policy (Cilium is present), which turns
  ADR-0028 Decision 3's "retains nothing" from a promise into something a
  manifest enforces. A pod that cannot talk to anything cannot exfiltrate
  to anything.
- **A leaked bearer token buys compute, not child data.** The analyser
  holds nothing, can fetch nothing, and answers only "which of these eight
  training types do these eight images look like." That is the same
  property ADR-0028 used to justify bearer-token auth for Phase 1, and it
  is what lets this design keep bearer tokens honestly (Decision 9).
- **Frame sampling is much cheaper than full decode**, and the clip
  duration is capped at 60 s (`CLIP_MAX_DURATION_SECONDS`), so the work is
  bounded by construction. Eight seek-based frame grabs read a small
  fraction of a 75 MB file.
- **The payload is small and bounded**: 8 frames at 448 px long edge,
  JPEG q≈80, is roughly 300–700 KB. Ingress body cap 8 MB, request rejected
  above it.
- It also **narrows the model choice to image models**, which is the right
  direction on a node with 8 GB of RAM (Decision 6).

Costs, stated:

- **The API pod does ffmpeg work in a background job.** Bounded (Decision
  7 caps batch size and forbids buffering the object), but it is real CPU
  on a pod that also serves requests. If this ever shows up in latency, the
  correct fix is a smaller batch or a longer interval, not moving decode to
  the GPU cluster.
- **Frames lose motion.** A model that could distinguish a pass from a shot
  by trajectory cannot here. For an eight-way coarse vocabulary this is
  very likely fine — Decision 6 makes it something to measure, not assume.
- **A second place ffmpeg is invoked**, alongside `VideoProcessingService`.
  Put the new method in that same service, not a new one.

**Decision: Option B.** The security properties are not marginally better,
they are categorically different: no media reference crosses, no audio
crosses, and the analyser can be network-isolated. The cost is CPU on the
API pod and a modelling constraint, both of which are cheaper than the
things Option A gives up.

**Retention of what crosses:** the frames exist in the request body and
nowhere else. The analyser holds them in memory for the duration of the
request. They are never written to disk on either side (the API streams
them straight into the request; the analyser's root filesystem is
read-only). No frame, no embedding, no score, and no request body is
logged on the GPU side — request logging of payloads is **off**, which is a
configuration item to verify on the running pod, not a note (ADR-0028
Decision 3 warns that several common inference servers log full prompts at
debug by default; the same class of default exists for image servers).

---

## Decision 5 — The vocabulary is the one already shipped, and `unclear_or_unrelated` is never a row

**No schema change to `video_clip_tag`.** The eight-value enum is already
in Postgres and is correct: small, closed, allow-listed, no identity, no
free text — the same structural move ADR-0018 Decision 4, ADR-0019 Decision
4 and ADR-0029 Decision 7 all make, and the same reason ADR-0018 refused
the "RAG database" framing in its own intake.

**The API is the enforcement point for the vocabulary, not the analyser.**
The analyser returns tag names as strings; `ClipTaggingService` validates
every one against `VideoClipTagValue` and **drops anything it does not
recognise**, logging a warning. A model swap, a prompt-set change, or a
buggy service can therefore never write a novel label into Postgres. Same
instinct as `storage_key` never being client-suppliable: the guarantee is
that no code path accepts the value, not that callers behave.

**`unclear_or_unrelated` is never persisted as a tag row.** It is
represented by `tagging_status = 'no_confident_tags'` with zero tag rows.

- A persisted `unclear_or_unrelated` row is a durable, machine-authored
  negative judgement attached to one child's video. That is the shape of an
  accusation, and per Decision 3 this system does not make those.
- It carries no information the absence of rows does not already carry.
  ADR-0018 Decision 4 already established that "a clip with no tag rows
  simply has 'no confident tags,' a normal, expected state, not an error."
- The enum value stays in the type, unused. Removing it is a migration for
  no gain, and leaving it costs nothing.

**Persistence rules:**

- Persist at most `CLIP_TAGGING_MAX_TAGS_PER_CLIP` (default **2**) tags,
  the highest-scoring ones at or above `CLIP_TAGGING_CONFIDENCE_THRESHOLD`.
  Two, not one, because "fitness_conditioning + running-style drill" and
  "shooting + team_drill" are both genuinely true of real clips; more than
  two turns a tag list into a description.
- `confidence` = the analyser's normalised score for that tag, in [0, 1],
  satisfying the existing CHECK.
- **`confidence` is not a probability, and this must be written down where
  a future consumer will read it.** A softmax over eight prompt embeddings
  is a ranking score, comparable only within one `source` version. The
  entity comment already anticipates a consumer writing `WHERE confidence >
  0.8`; that comment should be extended to say the number is only
  meaningful relative to the same `source`.
- `source` format: `{serviceVersion}/{modelId}/{promptSetVersion}`, e.g.
  `clip-tagger-2026.08.14-a1b2c3d/siglip-base-patch16-224/floorball-v1`.
  A varchar, per the shipped schema. It must encode the **prompt set** as
  well as the model, because with a zero-shot model the prompts are half
  the classifier — changing them changes the output with the weights
  untouched.
- **No re-tagging in v1.** A clip is processed once. Re-running an
  improved model over existing clips is a separate, deliberate operation
  (it rewrites derived records about children in bulk), and it is not
  designed here.

---

## Decision 6 — Model shape, and what to measure

The specific model cannot be chosen from here — nothing in this
environment can run it or judge its output on Swedish youth floorball.
What is decided is the shape, in the same posture ADR-0028 Decision 9 took.

### Fixed by this decision

- **A zero-shot image–text embedding model scoring sampled frames against
  a fixed prompt set, aggregated across frames.** SigLIP / OpenCLIP-class.
  Not a fine-tuned classifier, not a video model, not a VLM that writes
  sentences.
- **Open weights, licence permitting commercial use.** Non-negotiable, per
  ADR-0028 Decision 9, same reasoning.
- **No fine-tuning on anything a child produced, ever.** ADR-0028 Decision
  3 forbids it, and the zero-shot choice makes it structurally unnecessary:
  there is no training loop, so there is nothing for child media to be
  absorbed into.
- **The vocabulary lives in a versioned prompt file on the GPU side, not
  in the weights.** Changing how `stickhandling` is described is a config
  change and a `promptSetVersion` bump, not a retrain.
- **One model, one purpose.** No ensemble, no fallback chain, no router.

**Why zero-shot rather than a trained classifier**, argued because the
obvious engineering instinct is to fine-tune something on labelled
floorball clips:

- There is no labelled corpus, and the only place to get one is children's
  clips. That is the trap. A fine-tuning path makes child media training
  data, which is a categorically different processing operation from
  classifying it (the same distinction ADR-0028 Decision 3 draws for
  embeddings), and it would need its own consent analysis with a much less
  comfortable answer.
- Zero-shot is correctable by editing a text file. A coach who thinks
  `team_drill` is firing too often edits a prompt; nobody retrains
  anything. This is the same argument ADR-0028 Decision 6 made for
  retrieval over a Markdown corpus.
- It is small. A ViT-B/16-class image encoder is well under 1 GB at fp16 —
  which matters more than it sounds given the **8 GB host RAM** ceiling.
  A 15 GB A2 is wildly oversized for this; that is fine, and it means
  Phase 1's training-plan LLM and this can plausibly share a node later.

Candidates worth measuring, not a recommendation: SigLIP (base/so400m),
OpenCLIP ViT-B/16 and ViT-L/14, and — worth trying specifically because
prompts may work better in Swedish for a Swedish-authored prompt set — any
multilingual CLIP variant. Whether Swedish or English prompts score better
is an empirical question, not a principle; measure both.

### What to measure, in priority order

1. **Host RAM at steady state and during model load, on a real 8 GB
   node.** The binding constraint. Measure resident set after warm-up and
   the peak during load, not the parameter count.
2. **Confusion matrix over the eight values on the fixture set**
   (Decision 2, Stage 0b), including the deliberate negatives. The single
   number that matters most: **how often ordinary training clips score
   below threshold**, because that is the difference between a useful
   enrichment and a table full of `no_confident_tags`.
3. **A confidence threshold that yields acceptable precision.** Pick it
   from the fixture data, then treat Stage 0c's real distribution as the
   evidence that it transfers. Expect it not to transfer perfectly.
4. **Frames per second and end-to-end latency per clip** at concurrency 1
   and 2. Concurrency 2 is the honest ceiling: one sweep, one replica.
5. **Cold start** — pod restart to ready. This number sets the staleness
   threshold in Decision 8 and determines whether an eviction is invisible
   or a visible outage.
6. **Prompt sensitivity.** Re-run the matrix with reworded prompts. If
   accuracy swings wildly, the classifier is not robust enough to write
   durable records about children's videos, and the honest conclusion is
   to raise the threshold or not ship.
7. **Frame count sensitivity** — is 4 as good as 8? as good as 16? This is
   free latency if the answer is 4.

**A result worth naming in advance:** if the fixture matrix is poor, the
correct outcome is **not** to ship with a low threshold and a large
vocabulary. It is to ship with a high threshold and accept that most clips
get `no_confident_tags` — or to not ship. A mostly-wrong derived record
about children's videos is worse than an empty table, and there is no
product commitment forcing the issue.

---

## Decision 7 — The pipeline

### Producer: one scheduled sweep, Postgres as the queue

No new queue infrastructure. Redis is present but nothing uses it as a work
queue, and every background job in this app is `@nestjs/schedule` polling
Postgres — the boring, already-proven shape (`ClipRetentionService`,
`AccountErasureSweepService`, four others). `video_clip.tagging_status`
*is* the queue state; that is what it was added for.

`ClipTaggingService`, in `backend/src/video-clips/`:

```
@Cron(CLIP_TAGGING_CRON)                       // default: every 5 minutes
async sweep() {
  if (!(await tryClaimScheduledJobRunOrSkip(redis, logger,
        ERROR_LOG_JOB_NAMES.clipTagging))) return;
  if (!config.AI_TAGGING_URL) return;          // unset means off, silently
  ...
}
```

- New entry in `ERROR_LOG_JOB_NAMES`: `clipTagging: 'clip-tagging:sweep'`.
  One vocabulary for the Redis lock key and `error_log_entry.job_name`,
  per that file's own rule.
- Run-level failures write an `error_log_entry` with `source: 'job'` via
  `ErrorLogService.record`, exactly as `ClipRetentionService` does.
  Per-clip failures stay logger-only plus a Redis counter — the same split
  `ClipRetentionService` already argues for, and for the same reason (one
  row per clip per run would drown the pillar the operator reads).

**Selection query:**

```sql
SELECT id, storage_key, mime_type, duration_seconds
FROM video_clip
WHERE status = 'published'
  AND tagging_status IN ('not_processed', 'failed')
  AND tagging_attempts < :cap
ORDER BY created_at ASC
LIMIT :batchSize                               -- default 10
```

Oldest first, deliberately: a backlog drains in the order it accumulated,
and the "oldest unprocessed item age" number in Decision 8 stays
meaningful.

**Two additive migrations**, both trivial:

```sql
ALTER TABLE video_clip
  ADD COLUMN tagging_attempts smallint NOT NULL DEFAULT 0;

CREATE INDEX "IDX_video_clip_tagging_pending"
  ON video_clip (created_at)
  WHERE status = 'published'
    AND tagging_status IN ('not_processed', 'failed');
```

The partial index is what the entity comment asked for ("mirroring
`IDX_video_clip_status_expires_at`'s shape"), and it serves both the sweep
query and the oldest-pending-age query in Decision 8.

**No `in_progress` status, deliberately.** The cross-replica run-claim
already guarantees one runner, and a pod dying mid-batch leaves rows at
`not_processed`, which is the correct self-healing state — the next tick
retries. An `in_progress` status would need its own stuck-row recovery
sweep, which is a second failure mode invented to manage the first.

**`tagging_attempts` is incremented before the call, not after.** A clip
that reliably crashes the frame extractor or the analyser must not be
retried forever; incrementing first means a crash mid-call still burns an
attempt. Cap default 3.

### What the API does per clip

1. Mint a presigned GET (`CLIP_PLAYBACK_URL_EXPIRES_SECONDS`, the existing
   10 minutes). **This URL never leaves the API pod.**
2. Extract N frames (default 8) evenly spaced across the clip, skipping the
   first and last 5% (black frames, title cards, the hand reaching for the
   phone), scaled to `CLIP_TAGGING_FRAME_MAX_EDGE` (default 448 px long
   edge), JPEG q≈80, `-an`.

   Preferred: N invocations of `ffmpeg -ss <t> -i <presignedUrl>
   -frames:v 1 -an -vf scale=... -q:v 5 -f image2 <tmp>` with `-ss` before
   `-i`, so ffmpeg fast-seeks with HTTP range requests and never reads the
   whole file.

   **Unverified from here:** whether the Alpine `ffmpeg` package in the API
   image is built with HTTPS input support. Verify before building. If it
   is not, the fallback is a **new streaming** method on
   `ObjectStorageService` that writes the object to a temp file
   (`GetObjectCommand` body piped to a write stream), then extracts frames
   locally, then deletes it — with the same `try/finally` cleanup
   discipline `completeUpload` already uses.

   **`getObjectBuffer` must not be used here.** It buffers the whole object
   into memory; ten of those in a batch on a 2-replica pod is the same
   memory-exhaustion shape a security finding already closed on the upload
   path.
3. POST the frames (below), with `AbortSignal.timeout` — global `fetch` on
   Node 22, no new HTTP dependency. Default 30 s.
4. Apply threshold and cap, validate tag names against `VideoClipTagValue`,
   write the outcome.
5. Delete temp files in a `finally`, always.

### The contract

One endpoint plus health. Defined by this project, not inherited from any
model runtime — so the runtime is swappable without touching the app, the
same property ADR-0028 Decision 10 wanted.

```
POST {AI_TAGGING_URL}/v1/analyse-frames
Authorization: Bearer {AI_TAGGING_TOKEN}
Content-Type: multipart/form-data

  meta   application/json  { "requestId": "<fresh uuid v4>", "frameCount": 8 }
  frame0 image/jpeg
  ...
  frameN image/jpeg

200 ->
  { "requestId": "...",
    "serviceVersion": "clip-tagger-2026.08.14-a1b2c3d",
    "modelId": "siglip-base-patch16-224",
    "promptSetVersion": "floorball-v1",
    "scores": [ { "tag": "shooting", "score": 0.71 },
                { "tag": "team_drill", "score": 0.18 },
                ... all eight, always, descending ] }

GET {AI_TAGGING_URL}/health
200 -> { "status": "ok", "serviceVersion": "...", "modelId": "...",
         "promptSetVersion": "...", "gpu": true }
```

- **All eight scores are returned, always.** Thresholding is the app's job,
  because the threshold is a product knob that must be tunable in backend
  config without rebuilding and redeploying a GPU image.
- **`requestId` is a fresh random UUID, never the `clipId`.** If it were
  the clip id, the GPU cluster's logs would carry a stable identifier for a
  specific child's video even with payload logging off. The API logs
  `requestId` alongside `clipId` on its own side, which is where that
  correlation belongs.
- **`/health` mirrors the app's own `GET /health` convention** — a running
  pod can be asked what it actually is. That is the check CLAUDE.md credits
  with catching the 2026-07-30 wrong-image incident, and Decision 8 renders
  it in the console.
- **No other path is exposed.** The model runtime's own API, if the service
  fronts one, is a ClusterIP service inside the GPU cluster and is never
  routable from outside.

### Outcome mapping — how `tagging_status` is driven

| Analyser result | `tagging_status` | Tag rows | `tagging_attempts` | Batch |
|---|---|---|---|---|
| 200, ≥1 tag at/above threshold | `tagged` | up to 2 inserted | already incremented | continue |
| 200, nothing above threshold | `no_confident_tags` | none | already incremented | continue |
| 200, only `unclear_or_unrelated` above threshold | `no_confident_tags` | none (Decision 5) | already incremented | continue |
| 429 / 503 (analyser busy) | **unchanged** | none | **rolled back** | **stop this tick** |
| Timeout, 5xx, connection error, malformed body | `failed` | none | already incremented | continue |
| 4xx other than 429 (bad request — our bug) | `failed` | none | already incremented | continue |
| Frame extraction failed (corrupt/odd file) | `failed` | none | already incremented | continue |
| Clip no longer `published` at write time | **no write at all** | none | — | continue |

- **429/503 is backpressure, not failure.** "We did not get to look" must
  not consume the retry budget, and it must stop the batch — hammering a
  saturated single-GPU service with nine more clips is the retry loop
  ADR-0028 Decision 10 already refused.
- **A timeout does consume an attempt.** It is ambiguous, but a clip that
  reliably times out is a poison clip, and the attempt cap is what stops it
  looping forever.
- **The write is conditional and `affected` is checked**, exactly like
  `completeUpload`'s `lostRace` handling:

  ```ts
  const result = await manager.getRepository(VideoClip).update(
    { id: clip.id, status: VideoClipStatus.PUBLISHED },
    { taggingStatus: outcome },
  );
  if (!result.affected) return;   // deleted, hidden, or erased mid-flight — drop it
  await manager.getRepository(VideoClipTag).insert(rows);
  ```

  Tag rows and the status flip go in **one transaction**. The window is
  real: a clip can be self-deleted, reported-and-hidden, retention-swept, or
  erased between the frame extraction and the write. Dropping the result is
  the correct outcome in every one of those cases — and the FK's `ON DELETE
  CASCADE` is a backstop, not the primary control, exactly as ADR-0013
  Decision 6 frames the equivalent FK on `video_clip` itself.
- **A `hidden` clip is never selected**, per ADR-0018 Decision 5. A clip
  hidden after selection is caught by the conditional write.
- **Failure is silent to the user, always.** No push, no email, no visible
  state change, no effect on playback, feed order, deletion, or reporting.

### Backfill

There is no separate backfill mechanism. Every existing row defaults to
`not_processed`, so the ordinary sweep drains the live beta's whole clip
history oldest-first at `batchSize` per tick. **Named as a consequence
rather than discovered:** the first live tick begins processing every clip
the beta has ever published. At batch 10 / 5 minutes that is ~2 880 per
day, which comfortably exceeds this beta's total clip count — meaning the
backlog clears in well under a day and the "oldest unprocessed age" number
will look alarming for exactly that long. Do not tune it up to make the
number go down faster.

If the owner would rather only tag *new* clips, that is a one-line `AND
created_at >= :cutoff` and a config value — offered, not chosen here,
because it is a product question (Open Question 3).

---

## Decision 8 — Queue, backpressure, and what the console shows

ADR-0028 Decision 13 already decided this is a **panel inside the existing
Errors pillar**, not a fifth pillar, and already named the two Phase 2
numbers. This fills them in.

**Backpressure** has three layers, all boring:

1. `batchSize` (default 10) caps work per tick.
2. The analyser caps concurrency (1–2 on one GPU) and returns 429 above it,
   rather than queueing.
3. A 429 stops the batch immediately and changes nothing, so the sweep
   backs off to its next tick naturally. No retry loop, no exponential
   backoff to tune.

**What the panel shows:**

- Whether `AI_TAGGING_URL` is configured in this environment at all. Unset
  renders "not configured for this environment" — the same posture
  `USAGE_REPORT_*` already has on `ubuntu01`.
- A live `GET /health` fetch on panel load, short timeout: `serviceVersion`
  / `modelId` / `promptSetVersion` / `gpu`, or a plain unreachable state.
- Rolling 24 h counts of `tagged` / `no_confident_tags` / `failed` /
  `busy`, from **Redis, not a new Postgres table** — rebuildable
  operational numbers with no audit value, which is exactly ADR-0002's
  division of labour. Hourly bucket keys
  `ai:tagging:h:{YYYYMMDDHH}:{outcome}` with a 26 h TTL; the panel sums 24.
- **Pending count**, and — the number that matters —
  **`oldestPendingAgeSeconds`**, from `MIN(created_at)` over the same
  predicate the partial index already covers. Depth alone reads as zero
  both when the queue is healthy and when the producer has died; age does
  not. Above `CLIP_TAGGING_STALE_AFTER_MINUTES` (default 120) the panel
  renders a visible alert state, not a number someone has to interpret.
- **Tag distribution over the last 7 days**, aggregate, with a minimum
  count floor (reuse ADR-0020/0022's existing floor logic). This is the
  operator's only window into whether the model is behaving.

**Structural rule (Decision 1.5), as a type:**

```ts
interface AdminTaggingHealthView {
  configured: boolean;
  health: { reachable: boolean; serviceVersion?: string;
            modelId?: string; promptSetVersion?: string; gpu?: boolean };
  last24h: { tagged: number; noConfidentTags: number;
             failed: number; busy: number };
  queue: { pendingCount: number; oldestPendingAgeSeconds: number | null;
           stale: boolean };
  distribution: Array<{ tag: VideoClipTagValue; count: number }>;
}
```

No `clipId`, no `teamId`, no `playerId`, no `storageKey`, no screen name,
no free-text field. There is nothing here to wire a per-team filter to, and
adding one is a visible change to this type. The endpoint
(`GET /api/v1/admin/ai-tagging`, behind `AdminAuthGuard`) accepts **no
query parameters at all**, which the app's existing global
`ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true`) already
enforces by rejecting anything unlisted.

---

## Decision 9 — Cross-cluster auth and environment parity

**Direction: the app cluster calls the GPU cluster. Never the reverse.**
The GPU cluster initiates nothing, holds no credential for anything, and
has no route back in. Free, and the single most valuable property here.

### Auth

**Bearer token over TLS, plus an ingress IP allow-list.** With mutual TLS
named as the target if the eventual ingress choice makes it cheap, and
**explicitly not required day one** — which is a departure from ADR-0028
Decision 10's own instruction that Phase 2 must raise the bar to mTLS.

The argument, offered for the reviewer to accept or reject:

- ADR-0028 tied that instruction to media *references* crossing the
  boundary — "once media references cross the boundary, mutual TLS is the
  appropriate bar." Under Decision 4, **no media reference crosses.** No
  URL, no key, no id, no audio. What crosses is eight derived stills, in
  the request body, to a service that holds nothing and can reach nothing.
- The concrete loss from a leaked token is therefore **compute, not access
  to any child's stored video** — the exact property ADR-0028 used to
  justify bearer tokens for Phase 1. Option A would have broken it; Option
  B preserves it, and that was a large part of why Option B was chosen.
- mTLS across two clusters with no shared CA is real work — a CA, client
  cert issuance to the API pod, renewal, and an ingress controller
  configured to require and verify client certs — and **no ingress
  controller exists yet**, so the work cannot even be specified today. A
  security control that cannot be specified is not a control.

Defence in depth alongside the token, all cheap:

- TLS required (cert-manager is present on the GPU cluster).
- **Ingress IP allow-list** restricted to the app cluster's egress
  address. *Unverified from here:* whether that address is stable and
  allow-listable — Open Question 1.
- Request body size cap (8 MB) and a per-token rate limit at the analyser.
- `restricted` PodSecurity, read-only root filesystem, and **egress denied**
  (Decision 4) — so a successful exploit of an image-decode CVE in the
  analyser lands in a pod that can neither persist nor phone home.
- **No payload logging**, verified on the running pod, not assumed from a
  config file.

### Environment parity

CLAUDE.md's parity rule exists because Metro bakes absolute URLs into
static files at build time, which is why `site`/`mobile` need
per-environment images. **That mechanism does not apply to the analyser**,
and reaching for it would be the "second, runtime-detection mechanism
alongside the existing one" in reverse — ADR-0028 Decision 11 already made
this argument and it holds unchanged here.

- **One analyser image, environment-agnostic.** It holds no URL of ours,
  serves no HTML, links to nothing. Stamped with `SERVICE_VERSION` at build
  and reporting it at `/health`, exactly like the app images.
- **The pointer is per-environment runtime config**: `AI_TAGGING_URL` in
  each cluster's own ConfigMap, `AI_TAGGING_TOKEN` in each cluster's own
  Secret. NestJS reads `process.env` at request time; there is no
  build-time bake problem to solve.
- **Production points at the GPU cluster; `ubuntu01` leaves both unset**
  → the sweep returns immediately, the panel says "not configured", and
  the "unset means off" path gets exercised in a real environment rather
  than only in tests. Reasons: don't spend a shared GPU on test data, and
  `ubuntu01`'s reachability of the GPU cluster is unverified (the same
  class of gap ADR-0023 Decision B3 named rather than papered over).
- `k8s/README.md`'s hand-apply warning applies: the internal cluster's
  ConfigMap/Secret changes are not applied by the release poller.

**Separate config keys and a separate token from ADR-0028's Phase 1
`AI_INFERENCE_*` pair** — a departure, argued: the two workloads have
different risk profiles (one carries no child data at all, the other
carries derived frames), and they will be separate Deployments and
Services in `skillstreak-ai`. One shared token means enabling the training
plan generator silently enables clip analysis, and a leak of either is a
leak of both. Two names, two secrets, two independently-flippable features.

**Deploy safety, unchanged from ADR-0028 Decision 12** and already partly
in place: namespace `skillstreak-ai` (not `skillstreak`), manifests in
`k8s-ai/` (not `k8s/`), secrets `AI_KUBE_URL`/`AI_KUBE_TOKEN` (not
`KUBE_*`), context `skillstreak-gpu`, a CI job that shares no step with
`deploy`, and the `cluster-identity` assertion before every apply.

---

## Decision 10 — Advisory, never a publish gate

**Analysis never blocks publication.** Recommended and argued, though it is
also what ADR-0018 Decision 5 and ADR-0028 15.2 already concluded — worth
re-arguing rather than inheriting, because "just check it before publishing"
will be proposed again the first time a bad clip appears.

- **The publish path today has exactly one gate and it is deterministic.**
  Verified above: `completeUpload` publishes immediately after
  `remuxStripMetadata`. Inserting a model into that path changes every
  child's upload from "done" to "waiting", every time, in exchange for a
  probabilistic judgement about *training type* — which is not a safety
  judgement at all (Decision 3). The UX cost is certain; the safety benefit
  is zero, because there is no safety signal in the output.
- **It would hard-couple the app to a cluster that is free "at the
  moment."** A blocking gate means the GPU cluster going away stops
  children from posting clips. ADR-0028 Decision 14 exists to prevent
  exactly this, and the gate would make its "what breaks if the cluster
  goes away tomorrow" answer include "the video feature."
- **Post-hoc degrades safely.** Analyser down → clips publish exactly as
  today, `tagging_status` stays `not_processed`, which is already the
  default on every existing row and already means "nothing is wrong." The
  queue drains later. A blocking gate that is down is a feature that is
  down.
- The usual counter — that a bad clip is visible for a window before
  anything notices — **does not apply here at all**, because nothing in
  this design notices bad clips. ADR-0010 Decision 4's human report remains
  the only mechanism that hides anything, unchanged.

---

## Decision 11 — The searchable index, and the index deliberately not created

**Auto-tagging creates a derived index over children's video where none
exists today.** Today nobody can ask this system "show me clips of shooting
drills"; after this, the rows to answer that question exist. ADR-0028 15.3
insists this be a deliberate choice rather than a side effect. It is
deliberate, and here is what makes it defensible plus what is being given
up.

**What makes it acceptable:**

1. **The vocabulary is eight coarse values with no identity content.**
   `shooting` is not a biometric, not a description of a person, and not
   free text. It is roughly as revealing as the clip's duration.
2. **No embeddings are stored, anywhere.** Not on the GPU cluster (ADR-0028
   Decision 3), and not in Postgres. An embedding of a child's face is
   biometric-adjacent personal data and a categorically different
   processing operation; only the eight scores leave the model, and only up
   to two of them are persisted.
3. **The index inherits erasure and retention for free**, and this is the
   property everything else rests on. `video_clip_tag.clip_id` is `ON
   DELETE CASCADE`, so ADR-0013's erasure walk, `ClipRetentionService`'s
   90-day sweep, and the uploader's unconditional self-delete each take a
   clip's tags with them with **no new code path** and no new row in
   ADR-0013 Decision 6's per-entity table. ADR-0027's F3 is precisely what
   happens when that is not true.
4. **No query surface exists** (Decision 1.3): nothing a child touches can
   filter, rank, search, or order by a tag.
5. **The index that would make it searchable is deliberately not
   created.** The only index on `video_clip_tag` is
   `IDX_video_clip_tag_clip_id` — clip → tags, the direction the write path
   needs. There is **no index on `(tag)`** and none on `(tag, created_at)`,
   so "find all clips tagged `shooting`" is a sequential scan. This is a
   small, real, cheap structural control: the day someone wants that query,
   they must add an index, and that is a reviewable line in a migration
   rather than something that already works.

**What is genuinely given up, stated plainly:** after this ships, a durable
machine-authored record about each child's video exists in the production
database where none did before. It is coarse, it is deletable, it is
unreachable by any child, and it is scoped to the clip's own lifetime — but
it exists, and an operator with database access can read it. That residual
is the same shape and the same size as the one ADR-0020 already accepts
explicitly ("the operator already has DB access"), and it is stated here in
the same style rather than implied to be zero.

---

## Decision 12 — Statelessness, priced

**The GPU cluster retains nothing.** No frames, no embeddings, no cache, no
model outputs, no logs containing media or media references beyond the
opaque `requestId`. Enforced structurally, not by policy:

- **No PersistentVolumeClaim except read-only model weights** — and this
  design would rather have **no PVC at all** (see the manifests: bake the
  weights into the image if they are under ~2 GB, which a ViT-B-class
  encoder comfortably is). A container with no writable volume cannot
  become a media cache. `readOnlyRootFilesystem: true` plus an `emptyDir`
  for `/tmp` sized in tens of MB.
- **No object-store credential, no database credential, no SMTP
  credential, no JWT secret is ever issued to this cluster.** Decision 4
  removes the need for the first of these entirely, which also discharges
  ADR-0018's still-open least-privilege-MinIO finding by **removing the
  credential rather than scoping it** — a stronger answer than the one
  ADR-0028 15.5 anticipated, because there is no presigned URL either.
- **Egress denied** by network policy except DNS. This is the one control
  that makes "retains nothing" checkable from outside the container.
- **Payload logging off**, verified on the running pod.

**The price of ever breaking this**, restated so a future change is a
decision and not a discovery — ADR-0028 Decision 3 priced it in five
points, and every one of them still applies. The short version specific to
this feature: today the entire media inventory is **one Postgres table →
one `storage_key` → one object store**, which is why ADR-0013 Decision 5
could reduce a whole team's erasure to "purge objects, then one statement",
why ADR-0018's tag table cost nothing, and why ADR-0027's audio table cost
a blocking finding. A durable copy of anything on the GPU cluster adds a
second enumeration and a remote delete to **four** places
(`executeSingleErasure`, `executeTeamCascade`, `ClipRetentionService`,
`VideoClipsService.deleteClip`), puts a cross-cluster network call inside a
30-day compliance deadline, and adds a row to ADR-0013's per-entity table.

**No change is required to `ClipRetentionService`, ADR-0013's erasure walk,
uploader self-delete, or `remuxStripMetadata`** — and unlike ADR-0027, that
is a guarantee rather than an assumption, because the cascade already
covers the only new rows and no second store exists. If a future revision
of this design proposes durable state on the GPU cluster, this paragraph is
the one that goes first.

---

## Decision 13 — Where the code lives, and CI

Per ADR-0028 Decision 16, unchanged: **this repository**, a top-level `ai/`
directory, Python managed by `uv` (ADR-0003's first real exercise of that
convention, which CLAUDE.md itself anticipated for "a video-tagging
service"), a separate CI job building a separate image.

```
ai/
  clip-tagger/
    pyproject.toml            # uv; no pip/poetry lockfile alongside it
    src/clip_tagger/
      main.py                 # the HTTP service: /v1/analyse-frames, /health
      model.py                # load weights, encode frames, score prompts
      prompts/floorball-v1.yaml   # the versioned prompt set = promptSetVersion
    eval/
      run_fixtures.py         # Stage 0b harness -> confusion matrix
      README.md               # "fixtures contain no child of this app", and why
    Dockerfile
```

- Image `ghcr.io/issen007/skillstreak-clip-tagger`, SHA-tagged, built by a
  **new CI job that shares no step with `deploy`, `release`, or
  `internal-images`**. One image, no per-environment variants (Decision 9).
  `SERVICE_VERSION` build arg, reported at `/health`.
- The fixture *clips* are never committed. `eval/README.md` says so and
  says why.
- A pull secret on the GPU cluster if the package is private — check, it is
  a five-minute thing that will otherwise present as an unschedulable pod.

---

## Kubernetes manifests — illustrative sketches

Sketches for `k8s-ai/`, not final. `namespace.yaml` and
`cluster-identity.yaml` already exist and are unchanged. Every command
against this cluster passes `--context skillstreak-gpu` explicitly, and
asserts `cluster-identity` first, per `k8s-ai/README.md`.

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clip-tagger
  namespace: skillstreak-ai
spec:
  replicas: 1                      # one GPU's worth of work; not an HA story
  strategy:
    type: Recreate                 # a second pod cannot get the GPU anyway
  selector:
    matchLabels: { app: clip-tagger }
  template:
    metadata:
      labels: { app: clip-tagger }
    spec:
      runtimeClassName: nvidia     # REQUIRED — without it the pod runs and sees no GPU
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: clip-tagger
          image: ghcr.io/issen007/skillstreak-clip-tagger:<sha>
          args: ["--host", "0.0.0.0", "--port", "8080"]
          env:
            - name: SERVICE_VERSION
              value: "<baked at build; also reported at /health>"
            - name: CLIP_TAGGER_TOKEN            # the bearer token it accepts
              valueFrom:
                secretKeyRef: { name: clip-tagger-secret, key: token }
            - name: CLIP_TAGGER_MAX_CONCURRENCY  # 429 above this
              value: "2"
            - name: CLIP_TAGGER_LOG_PAYLOADS     # never "true"
              value: "false"
            - name: HF_HUB_OFFLINE               # no weight downloads at runtime
              value: "1"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          resources:
            requests: { cpu: "1", memory: "2Gi" }
            limits:
              cpu: "2"
              memory: "4Gi"        # 8 GB node, minus kubelet/system overhead
              nvidia.com/gpu: 1
          ports: [ { containerPort: 8080 } ]
          readinessProbe:
            httpGet: { path: /health, port: 8080 }
            initialDelaySeconds: 20      # tune from Decision 6's cold-start number
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /health, port: 8080 }
            periodSeconds: 30
            failureThreshold: 3
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            # Only if weights are NOT baked into the image — see below:
            # - { name: model-weights, mountPath: /models, readOnly: true }
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 64Mi }   # small on purpose: not a media cache
        # - name: model-weights
        #   persistentVolumeClaim: { claimName: clip-tagger-models, readOnly: true }
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: clip-tagger
  namespace: skillstreak-ai
spec:
  type: ClusterIP                  # never NodePort, never LoadBalancer
  selector: { app: clip-tagger }
  ports: [ { port: 8080, targetPort: 8080 } ]
```

### Network policy — the control that makes "retains nothing" checkable

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: clip-tagger-isolation
  namespace: skillstreak-ai
spec:
  podSelector: { matchLabels: { app: clip-tagger } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: <ingress-ns> }
      ports: [ { protocol: TCP, port: 8080 } ]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
      ports: [ { protocol: UDP, port: 53 }, { protocol: TCP, port: 53 } ]
    # Nothing else. No object store, no internet, no other pod.
```

`<ingress-ns>` is unknowable until an ingress controller exists — the same
blocker as everywhere else in this document.

### PVC — only if weights are too large to bake

**Preferred: no PVC at all.** Bake the weights into the image. A
ViT-B/16-class encoder at fp16 is a few hundred MB; an image around 2 GB
pulls once per node and makes the container fully immutable, which is the
strongest possible form of ADR-0028 Decision 3's rule. `HF_HUB_OFFLINE=1`
above exists to guarantee no runtime download attempts.

If a chosen model is genuinely too large, then and only then:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: clip-tagger-models
  namespace: skillstreak-ai
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast           # Cinder CSI; `large` is the default class
  resources: { requests: { storage: 20Gi } }
```

Rules on it, non-negotiable: **model weights only**, mounted `readOnly:
true` by the Deployment, populated exclusively by a separate one-shot
`Job` that is deleted afterwards, and it is **the only PVC this cluster
ever gets**. A read-only mount cannot become a media cache. Anything else
is `emptyDir`.

### Not sketched: the ingress

Deliberately. No ingress controller and no LoadBalancer exist on this
cluster, and which one gets installed determines the TLS termination, the
IP allow-list mechanism, the body-size cap, the access-log format, and
whether mTLS is cheap (Decision 9). Writing a manifest for a controller
that does not exist would be inventing facts. **This remains the live
blocker and it is infrastructure, not code.**

---

## Where this departs from ADR-0028

Listed together so the reviewer and the owner can accept or reject each one
individually, rather than finding them scattered.

1. **Sequencing (ADR-0028 Decision 4).** Video first, per the owner. This
   design does not restore the training-plan LLM but does restore the
   property that ADR's ordering existed to protect, via Stage 0b's
   non-child-data fixture stage (Decision 2).
2. **Auth bar (ADR-0028 Decision 10).** That ADR says Phase 2 must move to
   mutual TLS once media references cross. Decision 4 means none cross;
   Decision 9 therefore keeps bearer tokens with named compensating
   controls, and asks the reviewer to rule.
3. **Config split (ADR-0028 Decisions 10/11).** Separate
   `AI_TAGGING_URL`/`AI_TAGGING_TOKEN` rather than a shared
   `AI_INFERENCE_*` pair, so the two workloads are independently
   enable-able and a token leak is scoped.
4. **What crosses (ADR-0028 Decisions 3 and 15.5).** Those assume
   short-lived presigned GETs minted per request. This design sends
   derived frames instead and mints no cross-boundary URL at all — a
   stricter answer than the ADR anticipated, with a real cost (CPU on the
   API pod, loss of motion information).
5. **Scope (ADR-0028 Decision 15.1).** That section treats the escalation
   path as a precondition for Phase 2. Decision 3 satisfies it by building
   no detector, which makes the precondition inapplicable rather than
   answered. If the reviewer disagrees that a training-type classifier is
   meaningfully different from a moderation system, this design does not
   proceed.

---

## Explicitly NOT decided here

- **The specific model, its size, quantization, runtime, prompt wording,
  and frame count.** Decision 6 fixes the shape and the measurements; the
  numbers come from Stage 0b on the real hardware.
- **Any safety, abuse, nudity, age, or face classifier** — Decision 3
  refuses it in this phase; a separate ADR, review, and consent disclosure
  if ever wanted.
- **Any badge, points, evidence-tier, or challenge consequence of a tag** —
  Decision 1.4 rules it out for v1 and recommends against it until accuracy
  is measured. Not ruled out forever.
- **Player-visible tags, tag-based feed filtering, or tag-based search** —
  ADR-0018 Decision 4's internal-only rule stands until a separate decision
  changes it, and Decision 1 makes that a change to named types.
- **Anything cross-team.** ADR-0019's gate and ADR-0029 Decision 9 are
  untouched; tags may not be the back door.
- **Re-tagging existing clips after a model change** — Decision 5 rules it
  out of v1; a bulk rewrite of derived records about children needs its own
  thought.
- **Whether to backfill the existing clip history or only tag new clips** —
  Open Question 3.
- **The ingress controller, TLS termination, and the route itself** — the
  blocker, and outside this repo.
- **Whether the training-plan LLM (ADR-0028 Phase 1) shares this cluster,
  and how the two Deployments coexist on three A2s** — plausible and cheap
  (Phase 1 needs one GPU, this needs one), but not designed here.
- **Exact numbers**: batch size, cron interval, timeout, attempt cap,
  confidence threshold, max tags per clip, frame count, frame size,
  staleness threshold. All config values next to their existing
  neighbours, tunable without a new design doc — the same "mechanisms
  fixed, numbers free" split ADR-0010 established.

---

## Open questions for the project owner

1. **The route.** Does `skillstreak-gpu` have any ingress path yet, and
   does it need the same per-cluster Safespring Elastic IP request the
   `skillstreak` cluster needed? And: **does the app cluster egress from a
   stable IP** that can be allow-listed at that ingress? Both are
   preconditions, both are outside this repo, and the second one is not
   currently recorded anywhere.
2. **Confirm Decision 3.** This design builds a training-type classifier
   and explicitly no safety classifier. If the actual intent behind "video
   analysis" included detecting inappropriate content, say so now — it is a
   different feature with a different review, a different consent
   disclosure, and a legal question that should be started immediately
   because it is the long-lead item.
3. **Backfill or new clips only?** Every existing clip defaults to
   `not_processed`, so the default behaviour is to tag the entire beta
   history on the first live tick. A `created_at >= cutoff` filter is one
   line if you would rather not.
4. **The fixture set** (Decision 2, Stage 0b): who records or sources
   30–60 non-child floorball clips covering all eight vocabulary values,
   and are you comfortable being the one who labels them? Nobody else here
   can judge whether a clip is a `team_drill`.
5. **Is the return worth it?** Stated honestly in Decision 1: in v1, tags
   have no consumer except an aggregate admin panel. The work is a Python
   service, a GPU cluster, a CI job, two migrations, a NestJS job, and a
   blocking security review. The feature only starts paying when a
   consumer exists, and every plausible consumer (badges, filtering, search)
   is currently ruled out on purpose. It is entirely reasonable to look at
   that and defer — and better to decide it now than after the review.
