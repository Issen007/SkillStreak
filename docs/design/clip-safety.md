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

**This collides head-on with ADR-0028 Decision 1 ("self-hosted only, no
external AI service").** That decision was made about *tagging*, for GDPR
reasons, and it is a good decision there. Here the trade is different: the
alternative to a third party is **no known-CSAM detection at all**, and no
self-hosted substitute exists — the hash databases are the product, and
they are deliberately not distributed.

That is a decision for the project owner, and it should be recorded as an
ADR-0028 amendment either way. Refusing is a legitimate choice; refusing
*by accident*, because an existing decision said "self-hosted" about
something else, is not.

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

Mostly built: one report hides a clip immediately. What is missing is the
back half — `backend/src/moderation/` is an empty module shell, so there
is no queue where reported clips are triaged, no record of what was
decided, and no way to restore something reported in error.

### Layer 5 — the part that is process, not code

Easy to skip and the part most likely to cause real trouble.

- **The DSA applies to you.** SkillStreak is an EU hosting service and
  probably an online platform. That brings notice-and-action mechanisms,
  a published point of contact, terms describing how moderation works,
  and statements of reasons when content is removed. Some obligations
  have micro/small-enterprise exemptions — **check which apply rather
  than assuming none do**. This wants a lawyer's hour, alongside the
  privacy-policy review already on the launch checklist.
- **Know what to do the day it happens, before it happens.** If CSAM is
  found: preserve it, do not download it, do not forward it, do not
  "check" it by sharing it with anyone. Report to Polisen; in Sweden
  ECPAT's hotline is the established route and is part of INHOPE. Deleting
  it before reporting can destroy evidence.
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
2. **Layer 5 — the written procedure and the legal read.** Costs an
   afternoon and a lawyer's hour, and is what makes everything else
   defensible.
3. **Layer 1 — decide on hash matching**, and record the decision as an
   ADR-0028 amendment whichever way it goes.
4. **Layer 4 — finish the moderation queue**, so a report has somewhere to
   land and a decision leaves a trace.
5. **Layer 2 — the safety classifier**, last. It is the most work, the
   most false positives, and the least value while the public path already
   has a human on it.

Nothing here blocks the store launch, because public sharing is currently
switched off. **Layer 3 should be built before it is switched back on.**
