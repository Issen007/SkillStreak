# 0028 — A self-hosted GPU Kubernetes cluster for SkillStreak's own AI workloads

## Status

Proposed — 2026-08-11. This ADR records four decisions the project owner
has already taken (Decision 1's self-hosting rule and Decision 2's
two-cluster topology, plus the boundary rule in Decision 3 and the
sequencing in Decision 4) and designs the rest around them. Those four are
recorded with their reasoning so they don't get re-litigated; they are not
re-opened here.

**Two different review gates, deliberately, because the two workloads in
this ADR are not the same kind of thing:**

- **Phase 1 (the coach training-plan LLM + RAG, Decisions 5–13) needs a
  *scoped* security-reviewer pass, not a full-weight one.** Argued rather
  than assumed, using ADR-0020's own criteria for earning a scoped review
  ("no media, no new consent gate, no cross-team visibility path, and no
  new player-facing surface"): Phase 1 adds no media path, no new consent
  gate, no player-facing surface at all, and — the load-bearing property —
  **carries no child data of any kind**, by construction (Decision 7). What
  it *does* introduce, and what a scoped review should concentrate on, is
  genuinely new for this codebase: a first outbound call from the API to a
  service outside its own cluster, a second Kubernetes cluster with its own
  credentials, and a free-text field that an adult could type a child's
  name into (Decision 7's named residual).
- **Phase 2 (video moderation and tagging, Decision 15) needs a full
  blocking pass of exactly the weight ADR-0010, ADR-0019 and ADR-0027
  got, and nothing in it may be built before that pass lands.** It
  processes children's media, and — Decision 15's central point — a
  classifier that flags possible abuse in a child's video creates
  obligations the moment it first fires. This ADR deliberately scopes and
  constrains Phase 2 without specifying it.

**Claims this ADR cannot verify, stated plainly rather than assumed** (the
same standard ADR-0027 set when it labelled the STIM question unverified):

1. **The GPU cluster's actual hardware** — GPU model, VRAM per node, node
   count, driver/operator setup. Decision 9 therefore specifies the
   *shape* of the model decision and what to measure, and names no model.
2. **Safespring's terms** — what "currently free" covers, for how long,
   with what notice, and whether the cluster is single-tenant. Decision 14
   is written so the answer doesn't change the app's behaviour, only the
   feature's availability.
3. **Whether the GPU cluster is reachable from the app cluster at all
   today.** This is not a detail — it is a precondition, and this repo's
   own history says not to assume it. `k8s/README.md` records that the
   production `skillstreak` cluster needed a *per-cluster* Safespring
   Elastic IP request before anything answered on `:80`/`:443`, and that
   this is "a new, separate request" for each cluster ID. A second cluster
   very plausibly starts in the same state. See Open Question 1.

## Context

### The intake

`docs/internal/BACKLOG.md`'s "AI video analysis + self-hosted LLM/RAG on a
GPU cluster" entry, and the project owner's decision recorded there on
2026-08-11: **self-hosted only, no external AI service** — on GDPR grounds,
and because Safespring GPU resources are currently free. The owner also
asked whether to move SkillStreak onto the GPU cluster or keep two
clusters. Decisions 1 and 2 record both answers.

### What already exists in this repo, load-bearing for what follows

- **The publish pipeline is synchronous and has exactly one processing
  step.** Verified by reading it: `VideoClipsService.completeUpload`
  (`backend/src/video-clips/video-clips.service.ts`) HEAD-checks the
  uploaded object, buffers it, `probe`s it, runs
  `VideoProcessingService.remuxStripMetadata`
  (`backend/src/video-clips/video-processing.service.ts:131-157` —
  `-map 0:v:0`, optional `-map 0:a:0`, `-map_metadata -1`, `-c copy`), puts
  the stripped bytes back at the same `storage_key`, and only then flips
  `status` to `PUBLISHED` inside one transaction. There is no queue, no
  async stage, and no other gate. **Anything this ADR adds to the media
  path is a second gate on a path that currently has one** — which is
  Decision 15's reason for preferring advisory analysis.
- **ADR-0018's schema is already shipped; its service is not.** Migration
  `1785800000000-AddVideoClipTagging` created `video_clip_tag` (fixed enum
  vocabulary, `confidence`, `source`, `ON DELETE CASCADE` from the clip)
  and `video_clip.tagging_status` (`not_processed` default). Its own
  header says "schema-only: no service/job/queue consumes either of these
  yet." **Phase 2 of this ADR is the missing half of ADR-0018**, not a new
  feature — including its two still-open, required-before-deploy security
  findings (network posture; least-privilege MinIO credential), which
  Decision 15 has to answer because the two-cluster decision changes one
  of them materially.
- **The erasure walk enumerates media in exactly one way.** Verified in
  `backend/src/account-erasure/account-erasure.service.ts`:
  `executeSingleErasure` (line 505) does
  `videoClipRepository.find({ where: { uploaderPlayerId: row.playerId } })`
  and then `objectStorageService.deleteObjectIfExists(clip.storageKey)`
  for each; `executeTeamCascade` (line 452) does the identical thing with
  `{ teamId }`. One Postgres table, one `storage_key` per row, one object
  store. Decision 3 is built directly on this fact.
- **The scheduled-job and error-recording plumbing is already generic.**
  `common/scheduling/scheduled-job-run.util.ts` (extracted 2026-08-10 from
  six copies) is the cross-replica run-claim any future job reuses;
  `ErrorLogService.record({ source: 'job' | 'http', ... })` is the durable,
  admin-visible failure record, and it never throws.
- **The admin console is real and has four nav items.** ADR-0022's four
  pillars, `docs/design/phase7-admin-console-flows.md` §2's information
  architecture, and `admin/admin-environment.util.ts`'s environment badge
  (derived from `APP_PUBLIC_URL`, because `NODE_ENV` is `production` on
  both clusters and therefore cannot tell them apart). Decision 13 extends
  this rather than inventing a monitoring surface.
- **The backend has no HTTP client dependency at all** — no axios, no
  node-fetch, no undici in `backend/package.json`. The runtime is
  `node:22-alpine`, so global `fetch` is available. Decision 10's outbound
  call needs no new dependency.

### What does not exist, checked before assuming

- **No drill corpus, anywhere.** Grepped: the only "drill"-shaped things in
  the codebase are `ActivityType.DRILL`, two `WeeklyGoalTargetMetric`
  values, and ADR-0018's `team_drill` tag. There is no library of
  exercises, no coaching text, nothing retrievable. **The RAG corpus is not
  something this project has and indexes; it is something this project has
  to author or acquire** (Decision 6).
- **No coach login.** Phase 2's kapten pivot removed adult accounts; the
  in-app authority is a captain, who is a child. The only adult identities
  in this system are ADR-0023's `StaffAccount` (`admin` / `pt` roles, SSO,
  `staff_session` cookie). "A coach generates a training plan" therefore
  has no existing surface to land on — Decision 5 has to choose one.
- **No queue infrastructure.** Redis is present, but nothing in this app
  uses it as a work queue today; every background job is
  `@nestjs/schedule` polling Postgres.

### What this ADR is deliberately not

It is not a plan to make the app depend on AI. Every decision below is
written so that the answer to "what happens when the GPU cluster is gone"
is "one staff-facing feature returns an unavailable message, and nothing
else changes" (Decision 14).

## Decision — 1: self-hosted only; no external AI service, and no silent swap to one later

**Recorded, not re-litigated** — the project owner's decision, 2026-08-11,
on GDPR grounds and because the GPU resources are currently free.

Worth writing down *why this is stronger than a preference*, because the
practical pull toward a hosted API will return the first time inference is
slow: ADR-0010 Decision 1 refused a hosted media SaaS, ADR-0018 Decision 2
refused a third-party vision API, ADR-0020 Decision 2 refused a
third-party analytics SDK, and ADR-0022 Decision 6 refused hosted error
tracking — each for the same reason, each naming a new sub-processor of
children's data. Self-hosting the AI workload is what keeps **"no
third-party integration anywhere in a child's path" a literal statement
rather than a caveat in a privacy notice.** A project this size gets to
say that; very few products do, and it is worth more than a few hundred
milliseconds of latency.

**The consequence, stated so it can't be sidestepped:** swapping the
implementation behind Decision 10's internal contract for a hosted model
API is **not** a config change, even though the contract would make it
technically trivial. It is a new sub-processor decision requiring its own
ADR and its own blocking security review, exactly as ADR-0018 Decision 3
already said for the third-party path it rejected. The narrow interface in
Decision 10 exists to make the *self-hosted* implementation replaceable
(another cluster, a smaller CPU model, off), not to make the trust
boundary replaceable.

## Decision — 2: two clusters — the app stays where it is, the GPU cluster is separate

**Recorded, with reasoning, as the decision.** The owner asked whether to
move SkillStreak onto the GPU cluster; this is the recommendation and it
should be treated as settled.

- **Do not migrate a live beta holding real children's data weeks before a
  public demo.** The `skillstreak` cluster holds the real Postgres volume,
  the MinIO volume with real children's video, the DNS records, and the
  TLS certificates — and `k8s/README.md` documents how much of that was
  hard-won per-cluster (the Elastic IP request, the cert-manager Gateway
  wiring, the `letsencrypt-staging` → `prod` cutover). A migration buys
  nothing that two clusters don't, and pays for it in risk at the worst
  possible moment.
- **Isolation is the feature, not a side effect.** Inference workloads OOM,
  hang, and get restarted; that is their normal behaviour, not a
  malfunction. A workload with that profile must not share a node pool, a
  scheduler, or a memory budget with the process that serves a child's
  streak. This is the same instinct ADR-0010 Decision 1 used to keep video
  bytes off the API pod's own volume, applied to compute instead of
  storage.
- **GPU nodes are the wrong place to run Postgres.** They are expensive,
  scheduled around accelerator availability, and (per this ADR's own
  unverified-claims list) sitting on terms this project does not control.
  The durable state should stay on the boring cluster.
- **A third property, worth naming**: two clusters means the *credential*
  boundary is real. The GPU cluster holds no database credential, no MinIO
  credential, no SMTP credential, and no JWT secret. Decision 3 depends on
  that being true, and it is much easier to keep true across a cluster
  boundary than across a namespace boundary.

The cost is Decision 12's two-kubeconfig hazard, which is a real cost and
is answered there rather than waved off.

## Decision — 3: the GPU cluster is a stateless analyser — it retains nothing, and the cost of breaking that is written down here

**The rule: the GPU cluster receives work, returns a result, and keeps
nothing.** No frames, no clip copies, no embeddings of child media, no
response cache, no logs containing media or media references beyond an
opaque request id, and no fine-tuning on anything a child produced.

This is asserted in the intake. It deserves a real argument, because
ADR-0027's 2026-08-11 security review found exactly this failure mode one
level down and it was not obvious at design time: **finding F3 established
that `ClipAudioTrack` — a second store of children's recorded media —
silently reopened ADR-0013's erasure walk and `ClipRetentionService`, both
of which that ADR's proudest consequence claimed it did not touch.** A
child whose voice was on a team chant would have completed erasure while
their recorded voice kept being served. The feature was not careless; the
second store was simply invisible to the walk, and nobody noticed until a
reviewer read the walk.

**So: what does the walk actually do today?** Verified, not assumed
(`backend/src/account-erasure/account-erasure.service.ts`):

- `executeSingleErasure` finds `VideoClip` rows by `uploaderPlayerId`, then
  calls `ObjectStorageService.deleteObjectIfExists(clip.storageKey)` on
  each, then — in one transaction — anonymizes chat, nulls
  `Challenge.created_by_player_id`, deletes the `VideoClip` rows, deletes
  the `Player`, and finally `ZREM`s the leaderboard entry.
- `executeTeamCascade` finds `VideoClip` rows by `teamId`, purges the same
  way, then `DELETE FROM team` and lets Postgres cascade.

**Both enumerate media as: one Postgres table → one `storage_key` per row →
one object store.** That is the entire inventory. It is why ADR-0013
Decision 5 could reduce a whole team's erasure to "purge objects, then one
statement," and why ADR-0018's tag table cost nothing (it cascades from the
clip row) and ADR-0027's track table cost a blocking finding (it doesn't).

**What would have to change if the GPU cluster ever held a durable copy —
priced, so this is a decision and not a discovery:**

1. **A second enumeration and a remote delete in four places**, not one:
   `executeSingleErasure`, `executeTeamCascade`, `ClipRetentionService`'s
   daily sweep, and `VideoClipsService.deleteClip` (the uploader's
   unconditional self-delete, which ADR-0010 Decision 5 calls "this phase's
   actual answer to *please take this video down*").
2. **A cross-cluster network call inside a compliance-deadline path.**
   Today erasure either commits or leaves the batch for tomorrow, cleanly.
   Add a remote delete that can hang, and a 30-day statutory-ish deadline
   now depends on another cluster being up — and `AccountErasureSweepService`'s
   per-batch catch is deliberately logger-only, so a persistently failing
   remote delete looks, run after run, like an erasure that isn't due yet.
   (The run-level durable row that makes that visible exists today; the
   point is that a new remote failure mode would be leaning on it.)
3. **ADR-0013's per-entity table gains a row, and the whole ADR needs
   re-review** — it is the document a future contributor reads to know what
   "delete everything about this child" means.
4. **A new data category this app has never held.** Embeddings derived from
   a child's face or voice are biometric-adjacent personal data; storing
   them durably is a categorically different processing operation from
   storing the video that already exists, and would need its own consent
   analysis (the same reasoning ADR-0018 Decision 3 applied to tagging, but
   with a much less comfortable answer).
5. **ADR-0027 Decision 4's "one object per clip, still" property dies** —
   and with it the argument that retention, erasure and self-delete need no
   changes, which several ADRs now lean on.

**How the rule is enforced structurally rather than by policy** — the same
standard ADR-0022 Decision 5 holds itself to ("no field of that shape
exists in the type"):

- **No `PersistentVolumeClaim` in the GPU manifests, with exactly one
  named exception**: a read-only model/corpus volume (Decision 6/9), which
  the inference container mounts `readOnly: true` and which is populated
  only by an explicit, separate load step. A read-only mount cannot become
  a media cache. Anything else is `emptyDir`.
- **No object-store credential and no database credential are issued to the
  GPU cluster, ever.** Phase 1 needs neither. Phase 2 reads media via a
  short-lived presigned GET minted per request by the API — which also
  discharges ADR-0018's still-open least-privilege-MinIO finding by
  removing the credential rather than scoping it.
- **The inference server's request logging is off.** Prompt and response
  payloads are never written to logs; the request id is. This is a real
  configuration item, not a note — several common inference servers log
  full prompts at debug level by default.
- **Any future proposal to add durable state on the GPU cluster must
  re-argue this decision, not extend it** — the same clause ADR-0027's
  Consequences put around its own moderation posture, for the same reason.

**One thing this rule does *not* forbid, stated so it isn't
over-applied**: the drill-corpus index (Decision 6) is durable, and that is
fine. It contains no child data at all — it is coaching text. The rule is
about child media, not about every byte on the cluster.

## Decision — 4: sequencing — the training-plan LLM first, media second, and the order is the point

**Phase 1: coach training-plan generation with retrieval over a drill
corpus. Phase 2: video moderation/tagging. Not concurrently, and not the
other way round.**

- **Phase 1 contains no child data.** That is the whole argument. It proves
  the cluster, the deployment, the model runtime, the internal API
  contract, the cross-cluster auth, the failure behaviour and the admin
  visibility — with a workload that structurally cannot leak a child's
  anything. Every mistake made while learning to operate GPU inference gets
  made against coaching text about floorball drills.
- **It also unblocks a real, long-promised feature.** `docs/PROJECT.md`
  line 34's *"Ge mig ett roligt 15-minuters fyspass för 11-åringar"* has
  been in the product description since the beginning and has never had a
  design. CLAUDE.md still lists it as a headline feature.
- **Phase 2's hardest question is not technical and does not benefit from
  being rushed.** Decision 15 argues that the escalation path has to exist
  before the detector does. Sequencing gives that question the months it
  needs while something useful ships.

## Decision — 5: Phase 1's consumer is a staff account, not a child — and there is no child-facing prompt box

**The generator is exposed only to an authenticated `StaffAccount`
(ADR-0023's `admin` and, later, `pt` roles). No player-facing endpoint, no
captain-facing endpoint, no prompt field anywhere in the Expo app.**

Argued, because "a coach dashboard with a challenge builder" is in
CLAUDE.md's own feature list and the obvious reading is that a coach types
a prompt in an app:

- **There is no coach login to put it behind.** Phase 2's kapten pivot
  removed adult accounts deliberately; the only adult identities are
  ADR-0023's staff accounts. A captain is a child.
- **A free-text prompt box in front of a 12-year-old, wired to a
  generative model, is an unbounded content surface with no filter in front
  of it.** This app's entire text-moderation posture is
  `KeywordChatModerationCheck`, a Swedish wordlist over captions and chat.
  It cannot vet model output, and it cannot vet what a child types into a
  prompt. ADR-0019 Decision 4 refused stranger-facing freeform text and
  ADR-0027 Decision 3 refused child-supplied audio using the same
  structural move: don't build the unbounded surface. Generative output
  shown to children is the same shape of problem, one step further out —
  the app would be *authoring* the content rather than relaying it.
- **Where it lives, concretely**: one NestJS module, exposed as
  `POST /api/v1/admin/training-plans` behind `AdminAuthGuard`, and — when
  and only when the PT write-capability expansion is designed and reviewed
  (`docs/internal/BACKLOG.md`; ADR-0022's 2026-08-05 addendum) — the
  identical service exposed under `/api/v1/pt/*` behind `PtAuthGuard`. One
  shared module, two guards, zero duplicated logic: exactly the pattern
  ADR-0023 Decision B4 and ADR-0022's addendum already established.
- **A fifth admin-console nav item.** `docs/design/phase7-admin-console-flows.md`
  §2 argues for four items and against a fifth *landing page*; it does not
  argue against a fifth genuine pillar. This is a real pillar with a real
  screen (prompt in, plan out) and ux-designer owns it.

**What reaches children, and how**: nothing automatically. A generated plan
is text an adult reads, edits, and may choose to hand to a team — via the
existing weekly-goal/challenge mechanism, authored by a human, unchanged.
**v1 does not auto-create a `Challenge` from a generated plan**, and this
ADR recommends against it until there is real usage: an unreviewed model
output becoming a live team goal is precisely the "no human between the
model and the child" shape this decision exists to avoid.

**No points consequence, ever.** Stated explicitly, the same way ADR-0027
Decision 9 had to: a generated plan is not evidence that a child trained.
It must never award points, never create an evidence tier, and never be an
input to `TeamSeasonPot` or to any streak. Nothing in this ADR touches
either side of the scoring model — the individual-streak state (Redis,
rebuildable) and the team season pot ledger (Postgres, durable, auditable)
are both untouched, and the AI path sits entirely upstream of a human
decision that itself flows through the existing, already-reviewed paths.

## Decision — 6: the RAG corpus is authored and version-controlled by this project — not scraped, and not the internet

**The corpus is a set of plain Markdown documents describing floorball
drills and youth-training material, authored or explicitly licensed by the
project owner, living in this repository under `ai/corpus/`.**

Three candidates were weighed:

- **(A) Owner-authored / explicitly-licensed corpus — recommended.** A
  coach built this app; the drills are the one thing this project actually
  has domain authority over. Version-controlled Markdown means the corpus
  is reviewable in a diff, translatable, and — the load-bearing property
  for Decision 14 — **still exists if the GPU cluster does not**. It also
  has no rights question, which is the trap ADR-0027 spent an entire ADR
  documenting for audio.
- **(B) Scraped public coaching material** (federation handbooks, YouTube
  transcripts, forum posts). Rejected: it is ADR-0027's licensing problem
  in a new costume — someone else's copyrighted training material,
  reproduced verbatim into generated output that this project then hands
  to a coach. Also unbounded quality: advice about children's physical
  training, sourced from an unvetted crawl, is a genuinely bad idea
  independent of copyright.
- **(C) No corpus at all — bare model generation.** Honest option, and
  cheaper. Rejected as the target, but *not* as the first milestone: see
  the sequencing note below. A bare instruct model will happily produce a
  plausible 15-minute session; what it will not do is produce *this club's*
  drills, stay consistent between calls, or be correctable without
  retraining. Retrieval is how a coach fixes a bad answer by editing a
  Markdown file.

**Corpus content rules, non-negotiable and structural**: the corpus
contains **no child data of any kind** — no player names, no screen names,
no team names, no clip references, no training-log data. It is generic
coaching material. This is what makes Decision 3's "durable index is fine"
true, and what makes Phase 1's scoped review appropriate. A future
proposal to ground generation in a *specific team's* data is a different
feature with a different review.

**Retrieval mechanism — deliberately the boring one.** For a corpus of
tens to low hundreds of documents, embed at service start (or at image
build) and do brute-force cosine similarity in memory. **No vector
database service in v1** — no pgvector on the app cluster's Postgres, no
Qdrant/Weaviate pod. This is the same call ADR-0010 made about Redis for
the clip feed and ADR-0027 Decision 5 made about caching a fifty-row
catalogue: don't stand up a specialised store for data that fits in a
list. **The trigger to revisit**: a corpus in the low thousands of
documents, or a measured retrieval latency that is a meaningful fraction
of generation latency. Neither is close.

**Sequencing inside Phase 1**: get the inference path working end-to-end
with a fixed prompt template and a handful of corpus documents *before*
tuning retrieval. The riskiest part of Phase 1 is not the retrieval
quality — it is the two-cluster call, the auth, and the operational
behaviour. Prove those with three drills in the corpus.

## Decision — 7: prompts are not retained on the GPU cluster; generated plans are stored on the app cluster, and the request is structurally incapable of carrying child data

**Three separate questions, answered separately because they have
different answers.**

**(a) Does the GPU cluster retain the prompt?** **No.** Per Decision 3: no
request logging of payloads, no response cache, no transcript store. A
request is processed and forgotten. The GPU cluster's only durable
artifacts are the model weights and the corpus index.

**(b) Does the app cluster store the prompt and the generated plan?**
**Yes, in Postgres, and this is the right place** — the durable structured
store, per ADR-0002. A coach who generates a 15-minute session needs to
come back to it, and re-generating is not the same text. Shape:

```
TrainingPlanDraft
  id                    uuid, PK
  staff_account_id      uuid, FK -> staff_account.id, ON DELETE CASCADE
  prompt_text           varchar(1000)     -- what the adult typed
  generated_plan        text              -- what came back
  model_id              varchar           -- e.g. 'plan-gen-v1'; which
                                             implementation produced this,
                                             the same reasoning ADR-0018's
                                             VideoClipTag.source uses
  corpus_version        varchar           -- git sha of ai/corpus/ at
                                             generation time
  locale                enum, reusing PlayerLocale (ADR-0014)
  created_at            timestamptz
```

No `player_id`, no `team_id`, no FK to anything child-scoped — the same
structural exclusion ADR-0022 Decision 6 applied to `ErrorLogEntry`, for
the same reason and with the same consequence: **it needs no entry in
ADR-0013's per-entity erasure table, because there is nothing about a child
to erase.** `ON DELETE CASCADE` from `staff_account` handles the only
subject it does have.

**Retention**: a config-valued cutoff swept by the existing
`@nestjs/schedule` + `claimScheduledJobRun` pattern (recommend 365 days —
this is an adult's own work product, not child data, so the aggressive
windows elsewhere in this app are not the right analogue). Boring, reuses
the sweep shape four other services already have.

**(c) Can a prompt contain a child's data anyway?** **Yes, and this is the
one real residual in Phase 1 — named, not hidden.** A coach can type "give
me a session for Erik who is struggling with backhand" into a free-text
field. That string then travels to the GPU cluster and is stored in
Postgres. Three responses, in order of strength:

1. **Structural, and the one that actually matters: the request payload
   the API sends to the GPU cluster is a fixed DTO with no field capable of
   carrying app data** — `{ promptText, ageBand, durationMinutes, focus,
   locale }` and nothing else. The API **never** enriches a prompt with
   roster data, training-log data, streak data, or team names, and there is
   no code path that could. A future "personalise this plan for my team"
   feature would have to add a field to this DTO — a visible, reviewable
   change, not something that falls out of wiring up a UI. Same guarantee
   shape as ADR-0022 Decision 5's "no `teamId` parameter exists in the
   signature."
2. **Interface copy** (ux-designer): the prompt field says, in plain
   language, not to include players' names. Weak on its own; not nothing.
3. **Named as accepted residual**: an adult who types a child's first name
   anyway has done something this design discourages and does not prevent,
   into a system that keeps it on infrastructure this project controls,
   under the same operator who already holds Postgres credentials. That is
   materially smaller than the risks this app already accepts explicitly
   (ADR-0020's operator-already-has-DB-access residual), and it is stated
   here in the same style rather than implied to be zero.

## Decision — 8: what the generator is allowed to be wrong about — output constraints

Not a safety theatre section; two concrete constraints that follow from the
users being children even though children never touch this feature.

- **Generated plans are for a stated age band and must stay inside a fixed
  vocabulary of activity types** — the same enum the app already has
  (`ActivityType`: `fitness`, `drill`, `running`, `other`) rather than
  freeform activity names, so that a plan can eventually map onto a
  `Challenge`/weekly goal without a translation layer, and so the output
  has a shape rather than being prose soup. The prompt template enforces
  this; the response is parsed leniently and stored as text regardless
  (v1 does not hard-fail on a model that ignores the structure — that
  would make the feature flaky for no safety gain, since a human reads
  everything).
- **The output is advisory to an adult and is labelled as generated.** The
  screen says so; the stored row records `model_id` and `corpus_version`
  so that "why did it say that" is answerable later. This matters more
  than it sounds: physical-training advice for 9–13-year-olds is the one
  domain where a confidently wrong answer has a body attached to it, and
  the mitigation this project can actually offer is that a coach reads it
  first (Decision 5) and can see where it came from.

## Decision — 9: model selection — the shape of the decision, and what to measure

**This ADR names no model.** The available hardware is unverified (Status),
and a model name written here would be either wrong or stale before it was
read. What is decided is the *shape*:

**Fixed by this decision:**

- **Open weights, with a licence permitting commercial use.** Not
  negotiable — a licence that forbids commercial use makes the whole
  self-hosting argument moot the day this app charges for anything (which
  ADR-0022's own context anticipates for the PT product).
- **Served behind a standard inference runtime exposing an
  OpenAI-compatible HTTP API** (vLLM, Ollama, llama.cpp's server, or
  equivalent — backend-developer/ops call). Reason: it makes the model
  swappable without touching the app, and every candidate runtime speaks
  it. **The app never talks to this API directly** — Decision 10's own
  narrow contract sits in front of it, so a runtime change is invisible to
  the app too.
- **One model, one purpose, in v1.** No router, no ensemble, no fallback
  chain. If the chosen model is bad at Swedish, change the model; don't
  build a second one to compensate.

**What to measure before choosing, in priority order:**

1. **Swedish output quality**, first and not third. The users are Swedish
   coaches, `docs/PROJECT.md` is Swedish, and a large fraction of small
   open-weights models are markedly worse in Swedish than in English in a
   way benchmark tables do not show. Test with the real prompt
   (*"Ge mig ett roligt 15-minuters fyspass för 11-åringar"*), judged by
   the project owner, who is the only person here qualified to judge both
   the Swedish and the coaching.
2. **Fits in VRAM with real headroom at the intended context length**,
   including the retrieved corpus chunks, at whatever quantization is
   chosen — measured, not computed from a parameter count.
3. **Time to first token and total generation time** at concurrency 1 and
   2. Concurrency 2 is the honest ceiling: there is one operator and
   possibly a handful of PTs. If a plan takes 20 seconds, that is fine for
   this feature (Decision 10 sizes the timeout accordingly); if it takes
   three minutes, the model is too big for the hardware.
4. **Cold-start behaviour** — how long a restarted pod takes to be ready.
   This is the number that determines whether Decision 13's health panel
   shows "down" for 30 seconds or 10 minutes after every eviction.
5. **Refusal and hallucination behaviour on child-training prompts** — a
   model that refuses to discuss exercise for 11-year-olds, or invents
   dangerous plyometrics for them, is disqualified regardless of its
   benchmark scores.

**Not decided here**: quantization format, context length, the runtime,
the embedding model for Decision 6's retrieval, or whether the same model
serves both generation and embeddings. All are implementation choices
downstream of the measurements above.

## Decision — 10: how the app calls the cluster — one narrow internal contract, bearer-token auth, fail-soft

**Direction: the app cluster calls the GPU cluster. Never the reverse.**
The GPU cluster initiates nothing, holds no credential for the app cluster,
and has no route back in. This is the single most valuable property of the
whole design and it is free — take it.

**Contract**: one endpoint, one shape, defined by this project rather than
inherited from the model runtime:

```
POST {AI_INFERENCE_URL}/v1/training-plan
Authorization: Bearer {AI_INFERENCE_TOKEN}
  { promptText, ageBand, durationMinutes, focus, locale }
->  { plan, modelId, corpusVersion }

GET  {AI_INFERENCE_URL}/health
->  { status, serviceVersion, modelId, corpusVersion }
```

`/health` mirrors the app's own `GET /health` convention deliberately: the
image is stamped with what it was built from and a *running* pod can be
asked what it actually is — the exact check CLAUDE.md says would have
caught the 2026-07-30 wrong-image incident. Decision 13 renders it.

**Authentication — a shared bearer token, per-cluster, argued rather than
defaulted:**

- A ClusterIP-only posture is **not available across a cluster boundary**.
  This is worth stating loudly because ADR-0018's own security review made
  "ClusterIP-only, no Ingress/NodePort/LoadBalancer" a
  required-before-deploy condition for the classification service. That
  condition was written assuming one cluster; Decision 2 makes it
  impossible to satisfy literally. **It is discharged, not ignored, by the
  reasoning ADR-0010's own addendum already established for this project**:
  a request's security comes from its credential, not from whether the host
  is globally routable — "real AWS S3 works the same way" — and ADR-0022
  Decision 3 reused that argument to put the admin console on the public
  internet. The same reasoning applies here with less at stake, because
  Phase 1 carries no child data in either direction.
- `AI_INFERENCE_URL` and `AI_INFERENCE_TOKEN` are **runtime config from
  each cluster's own `ConfigMap`/`Secret`**, exactly like `JWT_SECRET`,
  `CORS_ORIGIN` and `ADMIN_COOKIE_SECURE` — never baked into an image (see
  Decision 11).
- **The honest limit of a bearer token**: unlike a presigned URL, it is a
  long-lived credential, and a leak means someone else's prompts run on
  this GPU. In Phase 1 the loss is compute, not child data — which is
  another reason Phase 1 goes first. **Phase 2's blocking review must
  revisit this**: once media references cross the boundary, mutual TLS (or
  an equivalent) is the appropriate bar, and cert-manager already runs on
  the app cluster.
- **The GPU cluster exposes that one path and `/health`. Nothing else** —
  in particular, the model runtime's own API is never exposed externally;
  it is a ClusterIP service *inside* the GPU cluster, fronted by this
  project's own thin service. That containment is what makes "one narrow
  contract" true at the network layer and not just in a document.

**Timeouts and concurrency:**

- A hard client-side timeout on the app side (recommend 60s, a config
  value) using `AbortSignal.timeout` — global `fetch` on Node 22, **no new
  HTTP client dependency** (verified: `backend/package.json` has none).
- The GPU-side service caps concurrency to a small number and returns
  `429`/`503` above it rather than queueing indefinitely. One operator and
  a handful of PTs will not generate contention; a retry loop would.
- **No retries by the app.** A generation attempt is expensive and
  non-idempotent in cost; the human presses the button again if they want
  it again.

**When the GPU cluster is unavailable — fail soft, and say so:**

- If `AI_INFERENCE_URL` is **unset**, the feature is off: the console
  pillar shows a plain "not configured for this environment" state and the
  endpoint returns a clear error. This is the same posture `ubuntu01`
  already has for the optional `USAGE_REPORT_*` config (`k8s/README.md`) —
  absent config means the feature no-ops rather than the app failing to
  boot.
- If the call times out or errors, the endpoint returns a specific error
  code the console renders as *"Plan generation is unavailable right now"*.
  The existing `AppExceptionFilter` records it to `error_log_entry`
  automatically — no new mechanism, and it lands in the admin console's
  existing Errors pillar for free.
- **Nothing player-facing degrades, at all, in any failure mode.** No
  player-facing endpoint, job, or screen calls this path. That is a
  property of Decision 5, and it is the reason Decision 14's "what if the
  free resources end" answer is short.

## Decision — 11: environment parity — the GPU cluster is environment-agnostic; the *pointer to it* is per-environment config

CLAUDE.md's environment-parity rule exists because Metro's web export bakes
absolute URLs into static files at build time, which is why `site`/`mobile`
get separate per-environment images. **That mechanism does not apply
here**, and reaching for it would be the "second, runtime-detection
mechanism alongside the existing one" CLAUDE.md warns against — in reverse.

- **The GPU-side service image is environment-agnostic: one image, one
  build, no per-environment variants.** It is a NestJS-free Python service
  that holds no URLs of ours, serves no HTML, and links to nothing. There
  is nothing environment-specific to bake. It is stamped with a version
  (`serviceVersion` in `/health`) the same way the app's images are, so
  "what is actually running" stays answerable.
- **The pointer is backend config, read at runtime**: `AI_INFERENCE_URL` in
  each cluster's own `ConfigMap`, `AI_INFERENCE_TOKEN` in each cluster's
  own `Secret`. This is precisely the convention ADR-0022 Decision 3 used
  for `ADMIN_COOKIE_SECURE`, with the same argument: a NestJS process reads
  `process.env` at request time, so there is no build-time bake problem to
  solve.
- **There is one GPU cluster, and both app environments may point at it —
  or the internal one may point at nothing.** Recommended: production
  points at it; `ubuntu01` leaves the config unset until there is a reason,
  so internal-test traffic doesn't consume GPU time and the "unset means
  off" path gets exercised in a real environment. **Named honestly**:
  `ubuntu01` is LAN-only with no public DNS, and whether it can reach the
  GPU cluster at all is unverified — the same class of gap ADR-0023
  Decision B3 named for OAuth redirect URIs on that cluster rather than
  papering over.
- **If both environments ever do share one inference service**, nothing
  needs to distinguish them, because the service keeps nothing (Decision
  3). That is a second, quieter payoff of the boundary rule.

## Decision — 12: the two-kubeconfig hazard — different names, different namespace, and an identity assertion before every apply

This is the highest-probability failure in the whole ADR, and it has a
precedent in this exact repository. CLAUDE.md records that on 2026-07-30,
production's `site` Deployment was running an `internal-images`-built image
and real visitors saw an unreachable `192.168.55.72` LAN address; both
images were built correctly, and the most likely cause named in this repo's
own handoff docs is a shared kubeconfig / wrong `kubectl` context. **A
second cluster doubles the number of ways to make that mistake.**

Verified how CI targets a cluster today (`.github/workflows/ci-cd.yml`, the
`deploy` job): it builds a kubeconfig inline —
`kubectl config set-cluster skillstreak-cluster --server=${{ secrets.KUBE_URL }}`,
credentials `github-actions-deployer`, context `skillstreak-context`,
namespace `skillstreak`. Four decisions, all cheap:

1. **The GPU cluster's namespace is `skillstreak-ai`, not `skillstreak`.**
   This is the single highest-value control: a command aimed at the wrong
   cluster fails with "namespace not found" instead of succeeding against
   the wrong one. Same-name namespaces on two clusters is the configuration
   that makes a mistargeted apply silent.
2. **Every literal name differs, with no shared prefix that autocompletes
   into the wrong one**: secrets `AI_KUBE_URL`/`AI_KUBE_TOKEN` (not
   `KUBE_*`), cluster `skillstreak-ai-cluster`, context
   `skillstreak-ai-context`, manifests in `k8s-ai/` (not `k8s/`), a
   separate CI job that never shares a step with `deploy`.
3. **An identity assertion before any apply, on both clusters.** Each
   cluster carries a `cluster-identity` ConfigMap with one key
   (`skillstreak-prod` / `skillstreak-ai` / `skillstreak-internal`); every
   deploy job reads it first and **aborts** unless it matches what that job
   expects. This is the deploy-time analogue of `/health`'s version stamp
   and of the admin console's environment badge — the same "ask the running
   thing what it is, don't assume" instinct this project already credits
   with catching exactly this class of error. It costs three lines of shell
   and is the only control here that catches a *correctly-named but
   wrongly-pointed* secret.
4. **For a human operator: two kubeconfig files, never one merged file.**
   `KUBECONFIG=~/.kube/skillstreak` and `KUBECONFIG=~/.kube/skillstreak-ai`,
   selected explicitly per shell. A merged file with two contexts is the
   configuration where `kubectl config use-context` and a forgotten `-n`
   combine into the 2026-07-30 incident.

## Decision — 13: what the admin console shows — because the failure mode is silence

ADR-0022's console is where operational truth lives, and the specific
failure this must make visible is **a workload that stops without erroring
loudly**: Phase 1 fails at the moment a human presses a button (visible by
definition), but Phase 2 is a background queue, and a background queue that
silently stops looks exactly like a background queue with nothing to do.

**A panel, not a fifth pillar.** It belongs inside the existing **Errors**
pillar (ADR-0022 Decision 6 / design doc §5), not as new top-level
navigation — ADR-0022 Decision 1 explicitly excluded infrastructure/cluster
health from that ADR's scope on the grounds that a real
Prometheus/Grafana stack is a bigger tool this project doesn't need. This
decision does not reverse that: it adds a handful of numbers about **one
dependency of this application**, which is application health, not cluster
monitoring. (The Phase 1 *generator* itself is Decision 5's separate,
staff-facing pillar; this panel is about whether the dependency is alive.)

**Phase 1 contents:**

- Whether `AI_INFERENCE_URL` is configured at all in this environment.
- A live `GET /health` fetch when the panel loads, short timeout, showing
  `serviceVersion` / `modelId` / `corpusVersion` — or a plain unreachable
  state. The version strings are the thing that makes "which build is
  actually running over there" answerable, which is the whole lesson of
  2026-07-30.
- Rolling 24h counts of ok / timeout / error, from **Redis counters, not a
  new Postgres table**. Correct per ADR-0002's division of labour: these
  are rebuildable operational numbers with no audit value, and Redis is
  where this app already puts exactly that. Nothing else is added to
  Postgres for observability.

**Phase 2 additions, named now so they aren't rediscovered later**: queue
depth, **and the age of the oldest unprocessed item**. The second number is
the one that makes silence visible — depth alone reads as zero both when
the queue is healthy and when the producer has died. A staleness threshold
(config value) turns it into a visible alert state rather than a number
someone has to interpret.

## Decision — 14: cost and reversibility — the app must keep working without the cluster, permanently

The resources are free *now*. This ADR treats that as a fact with an
expiry date rather than a foundation.

**What breaks if the GPU cluster goes away tomorrow:**

- The staff-facing plan generator returns "unavailable" (Decision 10).
  Existing `TrainingPlanDraft` rows are unaffected — they live in the app's
  own Postgres.
- Phase 2, if built by then, stops producing new tags. Clips continue to
  publish, because Decision 15 makes analysis advisory and never a gate.
  `video_clip.tagging_status` stays `not_processed`, which is already the
  default for every existing row and already means "nothing is wrong."
- **Nothing else. No player-facing feature, no streak, no leaderboard, no
  upload, no chat, no consent flow touches this path.**

**What keeps that true:**

1. **The corpus lives in this repository** (Decision 6), not on the GPU
   cluster. Losing the cluster loses compute, never content.
2. **The narrow contract in Decision 10** means the implementation behind
   it can become a smaller model on a CPU box, a different self-hosted
   cluster, or nothing at all — without touching the app. (Subject to
   Decision 1: it may not silently become a hosted third-party API.)
3. **No data of record ever lives on the GPU cluster** (Decision 3), so
   decommissioning it is `kubectl delete` and a config change, not a
   migration.
4. **No feature is designed to be impossible without it.** Coaches wrote
   training sessions before this existed.

**The cost that is real and not free**: operating a second Kubernetes
cluster — upgrades, GPU drivers/operator, image builds, a second set of
credentials to rotate, a second thing to check when something is wrong.
That is a genuine ongoing tax on a one-person project, stated plainly the
same way ADR-0018 Decision 2 stated its own ("real, non-trivial compute/ops
cost this project doesn't have today... not waved away by calling it
boring"). It is worth paying for Phase 1's feature; whether it is worth
paying for Phase 2 is a question Phase 2's own review should ask.

## Decision — 15: Phase 2 (video moderation and tagging) — scoped and constrained here, deliberately not specified

**Nothing in this section may be built before a full-weight blocking
security-reviewer pass, of the same weight ADR-0010, ADR-0019 and ADR-0027
received.** Phase 2 processes real video of real children through a machine
that makes claims about it. This ADR sets its boundaries and names the
questions that pass must answer; it does not design it.

### 15.1 What happens on a hit must be decided before the detector exists

**This is a design precondition, not an operational detail, and it is the
reason Phase 2 is not being specified today.**

A classifier that flags possible abuse in children's media creates
obligations **the moment it first fires**. A system that detects something
and has nowhere to send it is worse than no system: it manufactures
knowledge that nobody is positioned to act on, and "we knew and did
nothing" is a materially worse position than "we did not look." The
questions that must be answered *before* any detector runs:

1. **Who reviews a flag, within what time, and with what authority?** This
   app has no human review queue for anything. ADR-0010 Decision 4's
   un-hide is an out-of-band admin action; ADR-0027 Decision 3 explicitly
   refused to build an approval queue as a side effect of a music feature.
   A single operator cannot commit to a review SLA, and a flag with no SLA
   is a flag with no path.
2. **What is retained, and how does that collide with rights this app
   already grants?** ADR-0010's uploader self-delete is **unconditional and
   immediate, even with open reports** — deliberately. `ClipRetentionService`
   hard-deletes at 90 days. If a flagged item must be preserved for a
   review or a report, both of those promises acquire an exception, and
   that exception has to be designed (and disclosed) rather than
   discovered. Note the direction of the trap: the preservation obligation
   would attach to the *bytes*, which the child can delete today with one
   tap.
3. **Is there a legal reporting duty, and to whom?** **This ADR does not
   give legal advice and cannot** — the same position ADR-0027 took on
   music licensing, for the same reason. The owner needs real advice on
   Swedish reporting obligations before a detector exists, not after it
   fires.
4. **Who is told, and by what mechanism?** ADR-0010's report path emails
   the uploader's parent and the team coach. Reusing it for an *automated*
   flag means a machine accusing a child to their parent. That is a
   different act from relaying a human report, and it needs its own answer.
5. **What is the false-positive cost, concretely?** A shirtless
   eleven-year-old in a gym is an ordinary training clip and will fire a
   nudity classifier. In a small club where everyone knows each other, a
   false accusation attached to a named child is not a tuning parameter.
6. **Where does the flagged evidence live?** On the app cluster. Decision
   3 forbids the GPU cluster from holding it, and Phase 2's design must not
   quietly relax that to make preservation convenient.
7. **What is the model's provenance?** For any pretrained detector, its
   training data, its biases, and its behaviour on children's sports
   footage are unverifiable to this project. That is a fact to design
   around, not to assume away.

### 15.2 Advisory, not a publish gate — recommended, and argued

**Analysis must not block publication.** Recommended, and consistent with
what ADR-0018 Decision 5 already decided for tagging ("never a new upload/
publish gate... structurally, not 'usually fast enough not to matter'").
Three arguments:

- **The current path has one gate and it is deterministic.** Verified
  above: `completeUpload` publishes immediately after
  `remuxStripMetadata`. Inserting a model into that path changes the upload
  UX from "done" to "waiting" for every child, every time, in exchange for
  a judgement that is probabilistic.
- **It would make the app hard-dependent on a cluster that is free "at the
  moment."** A blocking gate means the GPU cluster going away stops
  children from posting clips. Decision 14 exists to prevent exactly this.
- **Post-hoc flagging degrades safely.** If the analyser is down, clips
  publish as they do today and the queue drains later. If a blocking gate
  is down, the feature is down.

The honest counter-argument, stated rather than hidden: advisory analysis
means a bad clip is visible to its team for some window before anything
notices. That window already exists today and is bounded by exactly the
same human-report mechanism (ADR-0010 Decision 4) — advisory analysis
shortens it, it does not lengthen it. Blocking would shorten it further, at
the costs above. That trade is Phase 2's review to confirm, but this ADR's
recommendation is clear.

### 15.3 Auto-tagging creates a searchable index of children where none exists today

Worth naming precisely: today, nobody can ask this system "show me clips of
shooting drills." ADR-0018's tags are internal-only by that ADR's own
Decision 4. Populating them and then building a filter turns a chronological
team feed into a **queryable index of children's video**. Inside one team
bubble that is defensible — fifteen kids who already know each other, all
of whom can already scroll the same feed.

**But it must be a deliberate choice, not a side effect of tagging.**
Concretely: populating `video_clip_tag` does not, by itself, authorise any
player-facing surface. ADR-0018 Decision 4's internal-only rule stands
until a separate decision changes it, and any search/filter UI must be
team-scoped by the same structural predicate every other team-scoped read
already uses (ADR-0010 Decision 2's bar).

### 15.4 "Easier sharing" must be pinned down before it is designed

The intake's phrase is ambiguous and the two readings are not the same
feature:

- **Tags used *within* a team** (find your own clips, filter the team feed)
  — straightforward, inside the existing bubble, no new visibility.
- **Tags that enable browsing *across* teams** — **this is ADR-0019's
  public-feed question in different clothes**, and ADR-0019 is blocked on a
  CLAUDE.md amendment only the project owner can make (its Status section:
  the closed-team-bubble sentence must be amended by the owner before that
  feature can ship at all). A tagging feature must not become the back door
  through which cross-team browsing arrives without that amendment. If
  cross-team discovery is wanted, it goes through ADR-0019's gate, not
  through this one.

### 15.5 What Phase 2 inherits, and what it must re-answer

Inherits, unchanged: ADR-0018's shipped schema (`video_clip_tag`,
`video_clip.tagging_status`), its fixed tag vocabulary, its cascade-delete
property, and its "failure is silent to the user" posture. Must re-answer,
because Decision 2's two clusters changed the ground under them: ADR-0018's
ClusterIP-only requirement (see Decision 10 for how it is discharged, and
why the bearer-token bar must be raised for media), and its least-privilege
MinIO credential requirement (Decision 3's answer: **no MinIO credential at
all** — short-lived presigned GETs minted per request by the API, which is
the same mechanism ADR-0010 already uses for playback and requires no new
trust).

## Decision — 16: where the code lives, and the package manager

**Recommendation: one repository (this one), a new top-level `ai/`
directory, Python managed by `uv`, and a separate CI job building a
separate image.** The genuinely open alternative is a second repository for
the AI service; surfaced rather than silently picked:

- **Monorepo — recommended.** CI already builds and pushes multiple images
  from this repo (`skillstreak-api`, `skillstreak-site`), so a third is an
  additive job, not a new pattern. The contributor count is one person plus
  agents; a split repo means two checkouts, two CI configs, and version
  drift between a contract and its consumer that nothing catches. The
  corpus (Decision 6) belongs next to the ADR that governs it. ADR-0003
  already designates `uv` for exactly this case — CLAUDE.md names "a video-
  tagging service" as the anticipated trigger — and ADR-0018 Decision 2
  already expected this to be the first real use of it.
- **Split repo.** Real argument: the AI service has a different language,
  a different release cadence, and a much larger image, and keeping GPU
  concerns out of the app repo's CI keeps `backend-test` fast. Rejected for
  now because the coupling that matters (Decision 10's contract) is exactly
  the thing a split repo makes easier to break, and because this project
  has no evidence of CI pain to fix. Reconsider if AI CI ever starts
  slowing down app CI measurably.
- **Do not reintroduce pip/poetry lockfiles alongside `uv`**, per ADR-0003.

## Decision — 17: explicitly NOT decided here

Named rather than silently dropped, in the same posture ADR-0019 Decision 9
and ADR-0027 Decision 10 use:

- **The model, its size, quantization, runtime, and the embedding model**
  (Decision 9) — the hardware is unverified, so these are measurements, not
  opinions.
- **Whether Safespring's GPU resources remain free, on what terms, and
  whether the cluster is single-tenant** — unverified, and Decision 14 is
  written so the answer doesn't change the app.
- **Whether the GPU cluster is reachable from the app cluster at all
  today** — an infra precondition outside this repo, exactly the class of
  item CLAUDE.md says to flag rather than plan around. Open Question 1.
- **All of Phase 2's actual design** — Decision 15 scopes and constrains it;
  it does not specify it, and it may not be built before its own blocking
  review.
- **Whether a generated plan can become a `Challenge` automatically** —
  recommended against for v1 (Decision 5), not ruled out forever.
- **Whether players ever see model-generated text** — recommended against
  (Decision 5); would need its own ADR and its own review, because it is a
  new content surface in front of children.
- **The corpus's actual contents and who authors it** — Decision 6 fixes
  the shape and the rules; the coaching material itself is the project
  owner's domain, not an architect's.
- **A vector database** (Decision 6) — deferred with a named trigger, not
  refused forever.
- **Any LLM use for the two other deferred items this could plausibly
  serve** — LLM-based chat moderation (`docs/PROJECT.md` Fas 5 item 3) and
  ADR-0022's blog/social-campaign generation. Both are real, both are
  plausible future tenants of this cluster, and folding either into this
  ADR would be scope creep. Chat moderation in particular is a
  *child-facing* content decision and would need the full ADR-0007
  treatment, not a note here.
- **Streaming responses, multi-turn conversation, or a chat interface of
  any kind** — one prompt, one plan, in v1.
- **Exact numbers**: timeout seconds, concurrency cap, retention days,
  staleness threshold, retrieval `k`. All config values next to their
  existing neighbours, tunable without an ADR — the same "mechanisms fixed,
  numbers free" split ADR-0010's Consequences established.

## Consequences

- **A second Kubernetes cluster and a second set of manifests** (`k8s-ai/`,
  namespace `skillstreak-ai`), a second deployer credential
  (`AI_KUBE_URL`/`AI_KUBE_TOKEN`), and a new CI job that never shares a step
  with `deploy`. Plus a `cluster-identity` ConfigMap on **every** cluster
  including the two that exist today, and an assertion step in every deploy
  job (Decision 12).
- **A new Python service** (`ai/`, `uv`, ADR-0003's first real exercise of
  that convention), one image, environment-agnostic, stamped with a version
  it reports at `/health`.
- **One new Postgres table** (`TrainingPlanDraft`) with **no player or team
  reference by construction** — so it needs no entry in ADR-0013's
  per-entity erasure table, the same property ADR-0022 Decision 6 gave
  `ErrorLogEntry`.
- **Two new backend config values** (`AI_INFERENCE_URL` in each cluster's
  ConfigMap, `AI_INFERENCE_TOKEN` in each cluster's Secret), both optional
  — absent means the feature is off, matching `USAGE_REPORT_*`'s existing
  posture on `ubuntu01`. `k8s/README.md`'s hand-apply warning applies: the
  internal cluster's ConfigMap/Secret changes are not applied by the
  release poller.
- **No new backend dependency** — global `fetch` on Node 22 (verified: no
  HTTP client in `backend/package.json`).
- **No change to `ClipRetentionService`, ADR-0013's erasure walk, uploader
  self-delete, or `remuxStripMetadata`** — and unlike ADR-0027, this is a
  guarantee rather than an assumption, because Decision 3 forbids the second
  store that would break it. If a future change to this ADR proposes
  durable state on the GPU cluster, this bullet is the one that goes first.
- **No change to either scoring model.** The individual streak (Redis,
  rebuildable) and the team season pot (Postgres, durable, auditable) are
  untouched; Decision 5 rules out any points consequence explicitly so it
  cannot be acquired by accident later.
- **A fifth admin-console pillar** (the plan generator, staff-only) and a
  small health panel inside the existing Errors pillar (Decision 13) —
  ux-designer owns the pillar's screen and copy.
- **Hand-off**: **security-reviewer** first — a *scoped* pass on Phase 1
  (Status section), concentrating on the cross-cluster credential, the
  structural no-child-data property of Decision 7's request DTO, and
  Decision 12's identity assertion. Then **backend-developer** (the NestJS
  module, the config, the `TrainingPlanDraft` migration, the `ai/` service,
  `k8s-ai/`, the CI job) and **ux-designer** (the generator pillar, the
  "generated, review before use" framing, the prompt-field copy in Decision
  7). **frontend-developer has no work from this ADR** — there is no
  player-facing surface, by design.

## Open questions for the project owner

1. **Is the GPU cluster actually reachable from the production app cluster
   today — and does it have any ingress/LoadBalancer path at all?** This
   repo's own history says not to assume: `k8s/README.md` records that the
   `skillstreak` cluster needed a *per-cluster* Safespring Elastic IP
   request before `:80`/`:443` answered, and that Elastic IP is per-cluster,
   not per-account. If the GPU cluster is in that state, Phase 1 is blocked
   on a support request outside this repo. **This is the first thing to
   check, before any design work continues.**
2. **What are the actual GPU model, VRAM, and node count?** Decision 9
   cannot be closed without them, and they determine whether the honest
   answer is a 7–8B-class model or something larger.
3. **What does "currently free" actually mean** — for how long, with what
   notice, and is the cluster shared with other tenants? Decision 14 makes
   the app survive any answer, but the answer determines how much is worth
   building on top.
4. **Who authors the drill corpus, and in which language first?**
   Recommended: Swedish first, by the project owner, starting with a
   handful of drills — Decision 6's sequencing note deliberately makes
   three drills enough to prove the whole path.
5. **Confirm Decision 5's staff-only consumer.** The product text says
   "coaches," and there is no coach login; this ADR puts the feature behind
   the staff/admin surface instead. If the intent is genuinely that a
   *captain* (a child) can generate training plans, that is a different
   feature with a child-facing generative-text surface, and it needs its
   own ADR and its own blocking review — it is not a small variation on
   this one.
6. **Phase 2's escalation path** (Decision 15.1) — this needs real legal
   advice on Swedish reporting obligations, and a realistic answer to "who
   reviews a flag and how fast," before any detector is built. It is the
   long-lead item; starting it now costs nothing while Phase 1 ships.
