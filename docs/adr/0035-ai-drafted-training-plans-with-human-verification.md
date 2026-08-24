# ADR-0035 — AI-drafted training plans, verified by a human before any child sees them

## Status

Proposed, 2026-08-24. Decided in substance by the project owner the same
day: **the AI drafts, the draft is held, and a human verifies it before it
reaches anyone — asynchronously, "during the week", rather than blocking
in real time. A draft nobody verifies expires and never publishes.**

This is "Tier A" of the AI-agent request in `docs/internal/BACKLOG.md`.
Tier B — a paid, lighter AI trainer for teams with no human trainer, with
automatic goals — is deliberately **not** in this ADR. It removes the
human verifier, which is the property this one is built around, and it
needs its own decision and its own blocking security review.

**A blocking `security-reviewer` pass is required before implementation**,
per CLAUDE.md: this puts machine-authored text in front of children.

## Context

### What already exists, and it is most of this

This ADR was drafted expecting to design a pipeline. Reading the code
first, almost all of it is built:

- **The generator.** `training_plan_draft`, `backend/src/training-plans/`,
  running on the separate self-hosted GPU cluster
  (`k8s-ai/plan-generator.yaml`). ADR-0028 made this the deliberate first
  AI workload because it touches no child data.
- **It is already exposed to trainers.** `POST /api/v1/training-plans`
  behind `PtAuthGuard`. ADR-0028 Decision 5 anticipated this ("the
  identical service exposed under `/api/v1/pt/*`") and it has since
  shipped. The entity is even already named `..._draft`.
- **A reviewed path for adult-authored content reaching children.**
  `trainer_post`: a PT writes one, it lands `pending_review`, an operator
  publishes or rejects it (`reviewed_by_staff_account_id`, `reviewed_at`,
  `rejection_reason`), and players read the published ones at
  `GET /api/v1/feed/trainer-posts`. Its own docstring states the control
  plainly: *"what matters here is not 'who may see this' but 'who put it
  in front of a child' — hence an operator review before anything is
  visible, recorded on the row."*

**So the human-verification pipeline this ADR was asked to design already
exists.** It was built for human-written tips. The question is whether
machine-drafted text may enter it, and under what marking.

### What does not exist, checked before assuming

- **No `verified` or `delivered` state on a plan draft.** A draft is
  `queued → generating → ready | failed` and then it is just text a
  trainer reads. Nothing carries it anywhere.
- **No team-scoped write path for a PT.** ADR-0023 Part A is read-only by
  design — a trainer cannot message, post to, or coach *through* the app
  at a specific team. The PT write-capability expansion is a separate,
  unreviewed backlog item.
- **`trainer_post` is app-wide, not team-scoped.** A published post goes
  to every player using SkillStreak. This is easy to miss and it matters
  below.

## Decision 1 — Reuse `trainer_post`; do not build a second review pipeline

A verified plan becomes a `TrainerPost` in `pending_review`, authored by
the trainer, published by an operator through the endpoints that already
exist.

The alternative — a review lifecycle of its own on `training_plan_draft` —
was rejected for the reason this project has learned twice: a second
mechanism doing the same job is how the two drift, and the review that
matters would then exist in two places with two standards. `trainer_post`
was designed for exactly this question and has already been reviewed for
it.

Concretely this is **one endpoint**:
`POST /api/v1/training-plans/:id/submit-as-post`, `PtAuthGuard`, valid
only on a draft owned by the calling account and in status `ready`,
creating a `TrainerPost` in `pending_review`.

## Decision 2 — The trainer is the author and is accountable; the model is a tool

`author_staff_account_id` is the trainer, not a synthetic "AI" account.

This is the whole reason Tier A needs no reversal of ADR-0028 Decision 5.
That decision permits *"text an adult reads, edits, and may choose to hand
to a team"* — a person taking responsibility for words a tool helped them
write, which is what a coach does with any source. Creating a non-human
author would make the model the publisher, and that is Tier B's problem,
deliberately not inherited here.

**The trainer must be able to edit before submitting.** A submit button
that forwards model output untouched makes "the trainer is accountable" a
formality. The editable text is what they are accountable for.

## Decision 3 — Provenance is recorded, and shown to the reviewer

`trainer_post` gains one nullable column:
`source_training_plan_draft_id uuid NULL REFERENCES training_plan_draft(id) ON DELETE SET NULL`.

Non-null means the text began as a model draft. Two consequences, and the
first is the point of the column:

- **The operator review screen must show it.** A reviewer working through
  a queue reads human-written and machine-drafted text differently, and
  should. Hiding the distinction would degrade the one control that stands
  between this and a child's screen.
- **`ON DELETE SET NULL`, not CASCADE.** ADR-0028 Decision 7's 365-day
  sweep deletes old drafts; a published post must not vanish because its
  source draft aged out. Same reasoning as `reviewed_by_staff_account_id`
  on the same table.

**What the child reader sees is left open for `ux-designer` and the
project owner**, and should not be decided here by default. The honest
positions conflict: a post carries a human `author_byline`, and putting
model text under a person's name unmarked is a real honesty question — but
"AI-generated" means very little to a nine-year-old and may read as a
disclaimer rather than information. Whatever is chosen, it must be
deliberate. Silence is also a choice, and the wrong one to arrive at.

## Decision 4 — What this does not touch

Restated explicitly, because each has been re-asked before:

- **No auto-created `Challenge` or weekly goal.** ADR-0028 Decision 5
  recommends against it by name; nothing here changes that. A goal is
  still authored by a human through the existing mechanism.
- **No points, ever.** A generated plan is not evidence that a child
  trained. It must never award points, never create an evidence tier, and
  never reach `TeamSeasonPot` or a streak (ADR-0028 Decision 5,
  ADR-0027 Decision 9).
- **No child data in a generation request.** ADR-0028 Decision 7's
  guarantee — that a request is *structurally incapable* of carrying child
  data — is untouched. Tier A gives the model no new inputs at all.
- **No change to team scoping.** `trainer_post` carries no player, team or
  clip reference and gains none here.

## Decision 5 — Expiry: say honestly that the safety property is already structural

The project owner's rule is that an unverified draft expires and never
publishes. **In this design it cannot publish, by construction**: the only
path to a child runs through `trainer_post.status`, which starts
`pending_review` and moves only by an explicit operator action. There is
no timer, and none is being added.

So the expiry is **housekeeping, not a control**, and this ADR says so
rather than dressing it up. ADR-0028 Decision 7's existing 365-day sweep
already bounds `training_plan_draft`; a shorter window for drafts never
submitted (suggested: 90 days, matching `CLIP_RETENTION_DAYS` and the
error-log window) is worth having so a trainer's list stays readable.

Recording it this way matters. A rule described as a safety control, which
is really tidiness, is how a future change quietly removes something load-
bearing while believing it removed clutter.

## Decision 6 — Delivery is app-wide first; team-scoped delivery is a later, separate decision

A published `trainer_post` reaches **every player using SkillStreak**, not
the team that hired the trainer. Named here because "the team adds the
trainer" makes the opposite assumption, and the mismatch would otherwise
be discovered in production.

- **App-wide, now.** Zero new review machinery, and the operator review is
  already in front of it. `trainer_post` carries `age_band` and `focus`,
  so the feed can at least be filtered rather than undifferentiated.
- **Team-scoped, later.** A plan written for one U11 team is often wrong
  for everyone else, so this is the better end state. It needs a PT write
  path into a specific team, which is the PT write-capability expansion —
  a separate backlog item with its own blocking security review.

Doing app-wide first is not a compromise: it is the half that needs no new
authorization surface, and it makes the second half easier to argue with
real usage behind it.

## Consequences

**Good:**

- Tier A is one endpoint, one nullable column, and a review-screen change.
  The pipeline, the guard, the generator and the feed all exist.
- No ADR is reversed. Decision 5's sentence about an adult reading and
  handing over is satisfied literally rather than argued around.
- The trainers the product already has get materially better, which is the
  owner's own stated view of where the value is.

**Costs, accepted:**

- **The operator review is the only real control, and it does not scale.**
  The same objection ADR-0027's review raised about moderating team audio
  applies here, and machine drafting makes submissions cheaper to produce
  and therefore more numerous. This is survivable at one operator and a
  handful of trainers; it is the first thing to break with growth, and it
  should be watched rather than discovered.
- **App-wide delivery is a blunt instrument** until team scoping exists.
- **A trainer who does not really edit** reduces accountability to a
  click. Nothing in the schema can detect that; it is a real residual.

**Explicitly out of scope**, and each is its own decision: Tier B in every
part (paid tier, automatic goals, video-sourced ideas, no human verifier);
feeding generated content into the drill library, which ADR-0029 keeps as
operator-curated Markdown with no runtime write path; and any change to
what the model is allowed to receive.
