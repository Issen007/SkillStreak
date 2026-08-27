# ADR-0036 — A second opinion on a clip, from a machine that never gets the last word

## Status

Proposed, 2026-08-27. `docs/design/clip-safety.md` layer 2, moved ahead of
layer 1 by the project owner the same day on the reasoning that a
classifier targets **novel** material — the risk this app actually
carries — while hash matching targets known material, which it barely
carries at all.

**A blocking `security-reviewer` pass is required before implementation**,
per CLAUDE.md. This processes children's media and creates a new durable
category of machine-authored judgement about a child; both halves of that
sentence are why.

### DEFERRED 2026-08-27 — the design stands, the build waits for evidence

**Project owner's decision, taken on this ADR's own open question 3.**
Layers 3 and 4 shipped this week and neither has met a real incident.
Building a source that *generates its own queue items*, before anyone
knows what the queues look like when humans fill them, would be sizing a
control against a guess — and this ADR already admits every threshold in
it is one.

**The design is not deferred, only the implementation.** Everything below
was decided and stays decided; what waits is writing the service. That
distinction matters, because the expensive part of this was the
reasoning — particularly Decision 3's "must not write `clip_report` rows"
and Decision 4's CASCADE, both of which are easy to get wrong under time
pressure and neither of which will need re-deriving.

**What has to be true before this is reopened** — the point of waiting is
to gather exactly this:

- **Public sharing is back on.** Layer 3's queue cannot see anything while
  `PUBLIC_SHARING_ENABLED_TEAM_IDS` holds one team and consent is
  revoked. Until then there is no traffic to learn from, by construction.
- **Both queues have run for a real period with real teams**, long enough
  to answer the only question that decides this: **how much operator time
  do the human-filled queues already take?** If they are already at the
  limit of one person, adding a self-generating source makes things
  worse, not safer — it buries the human reports, which carry more signal.
- **Or an incident happens that a classifier would plausibly have
  caught.** That is evidence too, and it outranks the volume argument.

**Recorded rather than left implicit**, because "we decided to wait" and
"nobody got round to it" look identical in six months, and only one of
them is defensible.

**What is accepted meanwhile**: clips that stay inside a team get no
automated review at all. What stands in for it is fifteen teammates who
can hide a clip with one tap, and an operator queue behind that. For the
public path, layer 3 already puts a human in front of every clip.

## Context

### What exists, and what it deliberately refuses

`ai/clip-tagger` scores sampled frames against a fixed vocabulary of
training types on the self-hosted GPU cluster. Its README says, in its own
words, that it is **"not a safety, abuse, nudity, age or face
classifier"**, and ADR-0028 Decision 3 refuses to make it one by accident.

That refusal is correct and this ADR does not overturn it. It builds the
thing next to it instead, and Decision 1 below argues why that is not
mere tidiness.

Four properties of the existing worker are worth restating, because this
design reuses all of them rather than inventing a second security posture:

1. **The worker never learns a clip id.** It receives a random `leaseId`
   and some JPEG bytes. A fully compromised worker holds a pile of
   anonymous stills.
2. **The worker cannot ask for anything.** There is no "give me clip X".
3. **A lease expires**, so a worker that dies releases its claim.
4. **A lease is single-use**, so a replayed response cannot rewrite a
   result — and the fixed vocabulary means a worker can never write a
   novel label into Postgres.

### What layers 3 and 4 already do

Both shipped this week and change what this classifier is for:

- **Layer 3**: nothing reaches a stranger without an operator watching it.
- **Layer 4**: a report hides a clip instantly, and there is now a queue
  behind that with decisions recorded and a way back.

So the public path already has a human on it. **This classifier is not
protecting that path** — it is for the far larger volume of clips that
stay inside a team, where nobody outside those fifteen people ever looks.

## Decision — 1: a separate service, not a prompt added to the tagger

Same pipeline shape, different service, different deployment, different
retention.

Not tidiness. A wrong training-type tag is noise: the app shows "passning"
when it was a shooting drill and nobody is harmed. **A wrong safety flag
is an accusation about a child**, and it is durable, and it is written by
software with no idea what it is looking at. Those two failures deserve
different blast radii, different retention rules, and different reviewers.

Merging them would also make the tagger's own README false, and that
README is currently load-bearing documentation of what this project does
not do.

## Decision — 2: advisory, never a gate

**A flag never blocks an upload, never hides a clip, and never prevents
publication.** It routes into the existing operator queue and nothing
else.

Three reasons, in increasing order of importance:

- **False positives are certain.** This is floorball. Bare arms, wrestling
  for the ball, a floor tackle, a child changing a shirt at the edge of
  frame — a nudity or violence classifier will fire on all of it.
- **A child blocked by a wrong machine judgement is a real cost**, paid by
  the child, silently, with no way to argue.
- **ADR-0028 Decision 14 requires the app to keep working without the GPU
  cluster**, which is free "at the moment". A gate would make a
  children's training app hard-dependent on a cluster that may go away.

## Decision — 3: it feeds the queue that already exists, as a second source

A flag lands in the **reported-clips queue** built for layer 4, alongside
human reports.

**It must not be written as a `clip_report` row.** That table is an
accountability record between people — "this player was reported, for this
reason, by someone" — and there is no player to attribute a machine flag
to. Synthesising one would corrupt the one audit trail whose value is
that every row is a person's judgement.

So a separate `clip_safety_flag` table, and the queue query gains a second
source. An operator sees both, told which is which, because "four
teammates reported this" and "a model scored this 0.82 on nudity" are
different kinds of claim and should be weighed differently.

## Decision — 4: what is stored, and what is not

**Only flags that crossed the threshold.** Not every score. ADR-0028's
tagger already refuses to store `unclear_or_unrelated` because a stored
negative judgement about a child's video is a thing that exists and can be
read; a table of "we scanned this child's video and thought about it" is
that at scale.

Stored per flag: the clip id, one category from a fixed vocabulary, the
score, the model id and prompt-set version, and when. Not raw model
output, not embeddings, not frames.

**`ON DELETE CASCADE` on the clip**, and this is a deliberate difference
from `clip_report`'s `SET NULL`. A report must outlive its clip because it
is a record about a *person*. A machine flag is not: once the clip is
gone, the flag is a durable negative statement about a child with nothing
left to check it against, and nobody able to say whether it was right.
**It should die with the clip.**

A dismissed flag is marked dismissed, not deleted, so the same clip is not
re-flagged forever — and so the dismissal rate is measurable, which
Decision 6 needs.

## Decision — 5: what a child is told is nothing

**No child ever sees a safety score, a flag, or that one existed.**

If an operator upholds a flag, the clip is hidden and the existing
moderation path applies — a human decision, communicated as one. If it is
dismissed, nothing happened and nothing is said, because nothing did
happen.

"Our software thinks your video may be inappropriate" is an accusation
from a machine to a nine-year-old about something that is wrong most of
the time. There is no version of that message worth sending.

## Decision — 6: a threshold nobody has calibrated is worse than none

**Ship with the flag routed to the queue and the threshold deliberately
conservative**, then tune on real dismissal rates.

The measurement that matters is the **fraction of flags an operator
dismisses**. High means the threshold is wrong and the queue is being
filled with sports footage; that is measurable from day one because
Decision 4 keeps dismissals.

Stated plainly so nobody reads a number as authority: this model has never
been evaluated on this project's own footage, the eval harness in
`ai/clip-tagger/eval` grades training types rather than safety, and until
there is real dismissal data **every threshold in this design is a
guess**.

## Consequences

**Good:**

- The largest surface — clips that stay inside a team, where no human
  looks unless a teammate reports — gets a second pair of eyes for the
  first time.
- It reuses the worker's four properties rather than inventing a second
  security posture, so nothing new is trusted.
- It degrades to exactly today's behaviour when the GPU cluster is absent.

**Costs, accepted:**

- **More work for one operator**, who is already the whole of layers 3 and
  4. This is the third queue pointed at the same person, and the first
  that generates its own items rather than waiting for a human to file
  one. If the dismissal rate is high it is actively harmful — it buries
  the human reports, which are the higher-signal ones.
- **A new durable category of judgement about children**, minimised by
  Decision 4 but not eliminated.
- **It will be wrong about floorball**, routinely, and the design's answer
  to that is an operator's time.

**Open, and needing the project owner:**

1. **Which model.** A real choice with real cost, and the eval question
   above rides on it.
2. **All clips, or only those headed for public?** This ADR assumes all,
   since the team path is the volume and a closed bubble does not make a
   bedroom video fine. Restricting to the public path would make the
   classifier nearly pointless, given layer 3 already puts a human there.
3. **Whether to build it at all yet**, given the operator cost above.
   Layers 3 and 4 shipped this week and neither has run against a real
   incident. There is an argument for letting them run first and finding
   out what the queue actually looks like before adding a source that
   generates its own items.
