# Keeping bad material out of the clip feed

Written 2026-08-26, after the project owner asked how to automatically
verify that uploaded video contains nothing it should not — explicitly
with the Instagram/Snapchat/TikTok incidents in mind, and explicitly
wanting to be clear about it *before* launch rather than after.

This is design reasoning, not an ADR. It exists so the decisions below get
made deliberately.

---

## Start with the honest part

**You cannot get to 100%, and any vendor who says otherwise is selling
something.** No platform on earth has. What is achievable, and what
regulators and parents actually ask about, is different:

> Was known illegal material blocked? Was new material found fast? Was
> there a route to report it? Did you act correctly when it happened, and
> can you show it?

Those are answerable, at your size, without a trust-and-safety
department. The goal is not zero incidents. It is that an incident is
rare, found quickly, handled correctly, and defensible afterwards.

## Why your situation is genuinely different from theirs

Worth being precise, because it decides where the money goes.

The incidents at those platforms are products of four things SkillStreak
does not have:

| They have | SkillStreak has |
|---|---|
| Open discovery — strangers reach strangers | Closed team bubbles; a clip reaches ~15 known teammates |
| Recommendation feeds pushing content at people who never asked | No algorithmic amplification of clips |
| Direct messages to strangers | No stranger contact of any kind |
| Millions of uploads a day | A handful, from verified team members |

**Your existing architecture is most of your safety story**, and it was
built before this question was asked:

- A clip's bytes are unreachable outside the uploader's team at two
  independent layers.
- Uploading at all requires an approved parental consent, per child.
- Publishing beyond the team requires an *additional* active
  public-sharing consent from that child's own parent, revocable at any
  moment (ADR-0030).
- 60-second cap.
- One report flips a clip to `hidden` immediately — no threshold, no
  quorum, no waiting for an operator.

That last one is worth noticing: a single teammate can remove a clip from
the feed instantly. In a closed group of people who know each other, that
is a fast and effective control, and it is the thing large platforms
cannot have because their audiences are strangers.

## The three risks that being small does *not* fix

Scale reduces exposure. It does not remove these.

1. **A child uploads sexual content of themselves.** In a 9–13 app this is
   the single most likely serious incident, it is a well-documented
   phenomenon, and it is legally CSAM regardless of who produced it. A
   small audience does not help — the material exists on your storage.
2. **A child uploads content of another child**, taken in a changing room
   or similar. Same legal category, plus a victim who did not consent to
   the recording.
3. **Someone uses the platform as storage or distribution** for known
   material, using a real account to do it.

None of the four architectural advantages above prevents any of these.
They are why automated checking is worth building rather than waving off
with "we are small".

---

## The layers, in order of value per unit of effort

### Layer 0 — what you already have

Listed above. Free, already built, and stronger than anything below it.
The main action here is to **write it down in the terms of service and the
parent-facing copy**, because a control nobody knows about does not
reassure anybody.

### Layer 1 — hash matching against known illegal material

**This is the one thing not to build yourself and not to skip.**

It works by comparing a perceptual hash of each upload against databases
of known material maintained by child-protection organisations. It is
reliable, has effectively no false positives, and it is what every serious
platform runs.

It also detects **only known material** — it will never catch case 1 or 2
above, which are new by definition. It is necessary and insufficient.

Realistic options:

- **Cloudflare CSAM Scanning Tool** — free, and you already use Cloudflare
  for DNS. Primarily image-oriented; confirm video coverage before relying
  on it.
- **Thorn Safer** — commercial, purpose-built, handles video, and adds
  classifiers for *new* material. The serious option if there is budget.
- **PhotoDNA (Microsoft)** — the original, licensed, requires an
  agreement; PhotoDNA for Video exists.

#### DECIDED 2026-08-27 — not now, and these are the triggers

**Project owner's call: no hash matching for launch.** Written out in
full, because declining a safety control is only defensible if the
reasoning is recorded and revisited. Otherwise it is indistinguishable
from never having thought about it.

**The reasoning is threat model, not cost.** Hash lists detect *known*
material. Redistributing it through SkillStreak would need a captain's
invite code, an approved parental consent, and an audience of about
fifteen teammates, any one of whom can hide the clip instantly with one
tap. That is a very bad distribution channel, and easier ones are
everywhere.

The realistic serious incident here is a child filming something they
should not, of themselves or a teammate. **That material is novel by
definition and no hash list contains it.** So this control is aimed at
the risk this app is least exposed to and does nothing about the one it
carries.

**What is being accepted, stated plainly**: if somebody does use this
platform to store or pass on known material, nothing here notices
automatically. What would catch it is a teammate reporting it and an
operator reviewing anything that goes public — both real, both human,
neither instant.

**The counter-argument, which is not weak**: if the threat model above is
wrong, hash matching is the cheapest insurance against the worst outcome,
and *"we had no known-CSAM detection"* is a bad sentence to say to a
regulator however good the analysis behind it was. That is the risk being
taken, deliberately.

**Reopen this when any of these becomes true.** Meeting one means
revisiting the decision, not noting it in passing:

- **Public sharing opens beyond the current allow-list.** It is enabled
  today for a single team via `PUBLIC_SHARING_ENABLED_TEAM_IDS`. Every
  argument above rests on the audience being known teammates; widening
  that is the moment it stops holding.
- **Any stranger-to-stranger surface appears** — a public feed of
  children's clips, cross-team video, direct messaging.
- **Any real incident at all** involving uploaded media.
- **The drill-library video question is answered "yes"**
  (`BACKLOG.md`), since that puts video into a deliberately cross-team
  surface.

**ADR-0028 Decision 1 stands and needs no amendment**, because nothing is
being adopted. The question was asked and answered no, which leaves that
decision intact rather than reversing it. Recorded here so nobody
re-litigates it from scratch.

**If it is ever adopted, adopt the local shape.** Compute PDQ hashes of
sampled frames on our own infrastructure — the frame sampler already
exists for clip-tagging — and match against a hash list held locally. No
child's video leaves; only a list comes inbound. That preserves ADR-0028's
actual concern rather than its literal wording, and is a materially
different proposition from posting clips to a vendor API. Obtaining a list
needs an agreement: IWF has tiered fees, C3P runs Project Arachnid Shield,
and NCMEC's list is generally for US-based providers.

*(Cloudflare's free CSAM tool was considered and does not apply here:
clips are served from Safespring object storage, not proxied through
Cloudflare.)*

### Layer 2 — automated classification of new material

Self-hosted, and the infrastructure already exists: `clip-tagger` samples
frames and scores them on a GPU, retains nothing, and reaches nothing.

**It must be a separate service, not a new prompt in the tagger.** The
tagger's own README refuses this explicitly — *"not a safety, abuse,
nudity, age or face classifier"* — and that refusal is right: a safety
score is a durable machine-authored judgement about a child, with
different retention rules, a different audit trail, and a different
failure cost than "this looks like a shooting drill". Same shape of
pipeline, different service, different decision.

Expect it to be **advisory, not a publish gate**, on the team path: false
positives on ordinary sports footage are certain (bare arms, wrestling
for the ball, floor tackles), and a child blocked from logging a session
by a wrong machine judgement is a real cost. Route hits into a review
queue instead.

**On the public path, flip that.** See Layer 3.

### Layer 3 — a human looks before anything leaves the bubble

**This is the highest-value change available, and it needs no AI at all.**

Today a clip goes public on parental consent alone, with no review step.
Volume is tiny — public sharing is one consent-gated feature, not the main
flow — and you already have the exact machinery: `trainer_post` runs an
operator-review queue with publish/reject and a recorded reviewer.

Making a clip's public publication go through the same queue means
**nothing reaches a stranger that a person has not watched.** At your
volume that is a few clips a week. It is cheap, it is comprehensible to a
parent, and it is the single answer that would prevent most of what the
owner is worried about.

It does not scale past one operator. That is fine now and is the first
thing to revisit if the feature succeeds.

### Layer 4 — report and take down

**Built 2026-08-27.** One report still hides a clip immediately; there is
now a queue behind it, decisions are recorded against an operator, and a
clip reported in error can be put back — which until then made a report a
one-way door any teammate could operate.

*(An earlier draft of this section said `backend/src/moderation/` was an
empty module shell. That was wrong: it holds the chat-moderation DI
binding and always did. The gap was the clip-report queue, which lived
nowhere.)*

Decisions are a separate table rather than columns on the clip, because a
clip can be reported, dismissed, and reported again by someone else with
a better reason — each is a distinct judgement and the earlier one must
survive. The queue asks for reports *newer than the last decision*, so a
re-report reopens it.

### Layer 5 — the part that is process, not code

Easy to skip and the part most likely to cause real trouble.

- **The DSA applies to you.** SkillStreak is an EU hosting service and
  probably an online platform. That brings notice-and-action mechanisms,
  a published point of contact, terms describing how moderation works,
  and statements of reasons when content is removed. Some obligations
  have micro/small-enterprise exemptions — **check which apply rather
  than assuming none do**. This wants a lawyer's hour, alongside the
  privacy-policy review already on the launch checklist.
- **Know what to do the day it happens, before it happens.** Written up
  2026-08-27 as `docs/INCIDENT-ILLEGAL-CONTENT.md`: preserve, do not
  download, do not forward, do not "check" it by showing anyone —
  possessing CSAM is itself an offence in Sweden, so the person trying to
  help commits one. Hide it, do not delete it, hold any pending account
  erasure, write down what you know, then call 114 14. ECPAT Sverige's
  hotline is the INHOPE route and does not replace the police.
- **One person is the on-call route.** Write down who, and what they do in
  the first hour. A one-operator project needs this more than a large one,
  not less.
- **Say all of it in the parent-facing copy.** The controls only reassure
  if someone knows they exist.

---

## Recommended order

1. **Layer 3 — operator review before a clip goes public.** Cheap, needs
   no model, reuses machinery that exists, and closes the highest-risk
   path outright. Do this first.
2. **Layer 5** — ~~the written procedure~~ **done**
   (`docs/INCIDENT-ILLEGAL-CONTENT.md`); the legal read is still open and
   is what makes everything else defensible. That document ends with five
   specific questions for the lawyer rather than a general "check
   compliance".
3. ~~Layer 4 — finish the moderation queue.~~ **Done 2026-08-27.**
4. **Layer 2 — the safety classifier.** Moved ahead of layer 1 by the
   project owner, 2026-08-27, on the reasoning the layer 1 decision turns
   on: **a classifier targets novel material, which is the risk this app
   actually carries.** Hash matching targets known material, which it
   barely carries at all.

   **Designed 2026-08-27 as ADR-0036, and deliberately deferred the same
   day.** The design stands; the build waits for evidence. Layers 3 and 4
   shipped this week and neither has met a real incident, so sizing a
   self-generating source of queue items now would be guessing at a
   volume nobody has measured.

   Reopen when public sharing is back on **and** both queues have run
   long enough to show how much operator time the human-filled ones
   already take — or on any incident a classifier would plausibly have
   caught. See ADR-0036's Status for the full trigger.

   This ordering is a correction. An earlier draft of this document put
   hash matching third and the classifier last — ranked by how
   externally-recognisable each control is rather than by which threat it
   meets. That was the wrong axis.
5. ~~Layer 1 — hash matching.~~ **Declined for now, with triggers** — see
   the layer 1 section above.

Nothing here blocks the store launch, because public sharing is currently
switched off. **Layer 3 should be built before it is switched back on**,
and it now is.
