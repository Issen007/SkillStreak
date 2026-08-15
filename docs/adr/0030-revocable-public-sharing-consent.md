# 0030 - Revocable public-sharing consent: the standing switch and its monthly reminder

## Status

**Proposed — 2026-08-15.** Design only. Nothing here is built, and
**blocking security-reviewer sign-off is required before any schema,
endpoint or screen exists**, per CLAUDE.md's standing rule and for the
same reason ADR-0019 carried it: this touches child media leaving the
team bubble, which is the highest-risk thing this project owns.

**This ADR does not unblock ADR-0019, and is not a second attempt at
it.** ADR-0019 already designed the cross-team clip feature in full —
per-clip publish approval, anonymization, the fixed reaction vocabulary,
reporting, un-publish, erasure, the query shape. That design stands and
is not restated here. ADR-0029 Decision 9 then confirmed the boundary
from the other side: of the three cross-team variants it examined, "the
uploader opts in, with parental approval" was rejected *as a new
mechanism* precisely because it **is** ADR-0019, and it warned that
restating it under a different name would be that ADR's failure
condition. This ADR takes that seriously and deliberately adds only
what ADR-0019 does not have.

What it adds is the project owner's own proposal, 2026-08-15:

> *"could we do some sort of parent approval where they can Enable and
> Disable their approval and we sending a reminder to the parent email
> if the account is enabled every month?"*

That is a **standing, revocable consent state with a recurring
re-contact**, and ADR-0019 has no such thing. It is also — and this is
the reason this ADR is worth writing rather than folding into a
one-line amendment — a direct answer to the question ADR-0019 left open
and explicitly flagged rather than resolved:

> *"Open, flagged rather than answered: whether correcting the copy
> forward is legally sufficient, or whether existing families need a
> real re-consent event."*

The owner has now proposed a real re-consent event. Decisions 1 and 2
below are what it takes for that to actually be one.

**Both of ADR-0019's owner-only prerequisites remain open and are
unaffected by this ADR:** amending CLAUDE.md's closed-team-bubble
sentence, and correcting the "only your own team" consent copy that is
live across six surfaces. Decision 7 argues this design makes the second
one materially smaller and more honest, but does not close it. Neither
prerequisite is something any agent in this repo may self-certify past.

## Context

### What exists today

- **Account-level media consent** — a parent approves the account before
  any upload. Obtained under an explicit, repeated promise that clips
  are visible to the child's own team and nowhere else.
- **Per-clip publish approval** (ADR-0019 Decision 1) — designed, not
  built. A standalone workflow layered *on top of* account-level
  consent, never replacing it.
- **Revocable per-player PT consent** (ADR-0023 Decision A3) — built and
  reviewed. `backend/src/pt/pt-consent.service.ts` carries
  `approveByReviewCode`, `declineByReviewCode` and `revokeByRevokeCode`:
  a mailed, code-addressed consent that a family can withdraw at any
  time without logging in. ADR-0019's own security pass named this file
  the shipped reference implementation of the pattern it wanted.

### The gap this ADR fills

ADR-0019's consent story is per-clip approval sitting on top of a
media consent that was **obtained for a different purpose**. A parent
who approved "my child may upload clips to their team" in March did not
consent to cross-team visibility, and no amount of per-clip approval
later changes what that original grant covered. ADR-0019 knew this — it
is why the consent-copy correction is listed as a mandatory blocking
prerequisite rather than a tidy-up.

There is also no *state* to point at. Consent that exists only as a
series of per-clip decisions cannot be inspected, cannot be
reconsidered as a whole, and cannot be withdrawn as a whole. A parent
who wants to know "is my child's stuff visible to strangers right now?"
has nowhere to look and nothing to switch off.

The owner's proposal supplies both halves: a thing that is on or off,
and a monthly email that makes sure someone is still deciding.

## Decision — 1: a new, separate consent — never a reinterpretation of the media consent already held

Public-sharing consent is its **own** account-level grant, with its own
mailed parental approval, its own record, and its own revocation. It is
not a flag added to the existing media consent row and not a migration
of it.

**Default is off, for every account, including every account that
already exists.** There is no backfill, no "families who consented to
media are treated as consenting to this", and no opt-out framing
anywhere in the flow.

This is the load-bearing decision, and the reason is not tidiness:

- **It makes the re-consent event real.** ADR-0019 asked whether
  correcting the copy forward is enough or whether families need a
  genuine re-consent. A separate grant, default off, obtained by its own
  approval mail, *is* the genuine re-consent — not a notice that terms
  changed, but an affirmative act that did not exist before.
- **It keeps the existing promise true for everyone who has not acted.**
  Every current family was promised team-only. Under this design that
  promise does not become false for them, because for them nothing
  changes. This is the difference between a guarantee that was narrowed
  and a guarantee that was broken, and it is the whole reason Decision 7
  can talk about correcting copy rather than retracting a claim.
- **It survives the "we'll just migrate the flag" pressure later.** Once
  the two consents are separate rows with separate provenance, merging
  them is a visible, arguable change rather than a quiet one.

The mailed approval reuses `pt-consent.service.ts`'s pattern rather than
inventing a third one, including its approve/decline preconditions,
single-use semantics and the "the approving recipient has a way back"
amendment ADR-0019 added.

## Decision — 2: the switch is standing state, and off is instant, unconditional and total

The parent can disable at any time, and disabling:

1. Takes effect **immediately**, with no confirmation step, no
   cooling-off period, no "are you sure you want to lose your audience"
   interstitial, and no email round-trip.
2. **Un-publishes everything currently public**, reusing ADR-0019
   Decision 5's immediate un-publish rather than adding a second
   takedown path.
3. **Deletes nothing.** Clips return to team-only visibility and stay in
   the team feed and the child's archive. Withdrawing consent to
   *publication* is not a request to destroy the child's own material,
   and conflating the two would punish the safer choice.
4. Requires **no login**, addressed by a signed code exactly as
   `revokeByRevokeCode` already is — because the person most likely to
   need this urgently is a parent who has never opened the app.

Re-enabling later is a fresh grant, not an undo. It does **not**
re-publish anything that was un-published; those clips need per-clip
approval again. A switch that silently restores an old audience is not
a switch anyone can reason about.

## Decision — 3: the switch gates eligibility — it never publishes anything by itself

Two gates, both required, neither implying the other:

| Gate | Scope | Who | ADR |
|---|---|---|---|
| Public-sharing consent | account, standing | parent | this ADR |
| Publish approval | one clip | parent | ADR-0019 Decision 1 |

Enabling the switch makes a child's clips **eligible** to be put
forward. It publishes nothing that exists, and nothing uploaded later
goes public without its own per-clip approval.

This is deliberately more friction than the owner's sentence strictly
requires, and the reason is the failure mode a standing consent invites:
a parent enables it in January for one specific clip, forgets, and in
June the child publishes something the parent would never have agreed
to. Standing consent plus per-item consent is the combination that makes
the January decision non-load-bearing for the June clip.

It also preserves the property ADR-0019 fought for and ADR-0029 Decision
9 defended in all three of its rejected variants: **no one but the
uploader's own parent ever decides that this child's video goes out**.
Not a captain, not a coach, not the operator, not a team-level setting.

## Decision — 4: the monthly reminder is a safety mechanism, and must read like one

While the switch is enabled, the parent receives an email once a month.
This is the owner's mechanism, and the design question is what it
contains.

**It must say:**

- That public sharing is **currently enabled** for this child, in the
  first line, before anything else.
- **How many** of the child's clips are public right now — including
  when the answer is zero.
- A **one-click disable link**, working without login, per Decision 2.
- A link into the app to see exactly which clips those are.

**It must not contain:**

- **Thumbnails or frames of the child's clips.** Email is the wrong
  place for child media: it lands in an inbox, gets copied by an email
  provider, and can be forwarded outside the app's control entirely. A
  count and a link keeps the media where the app can still govern it.
- **Anything engagement-shaped** — no view counts, no reaction totals,
  no "your child's clip is doing well". The moment this email carries
  good news about performance it becomes an argument for staying
  enabled, and it is supposed to be a neutral prompt to reconsider.
- Anything about other children.

**It is sent when the count is zero too**, which is worth stating
because the opposite is the tempting optimisation. The subject of this
email is the *standing permission*, not the activity. A quiet month is
exactly when a parent has most likely forgotten the switch is on, and
suppressing the email then would mean the reminder is most reliably
absent precisely when it is most needed.

## Decision — 5: a reminder that cannot be delivered disables the consent

If the monthly email hard-bounces or otherwise fails delivery for **two
consecutive months**, public-sharing consent is automatically disabled,
with the same immediate un-publish as a manual disable.

An undeliverable parent address on an account whose media is visible
outside its team is not a mail problem — it means the one person
supervising this arrangement is no longer reachable, and the supervision
the whole design rests on has silently stopped. Failing closed is the
only defensible direction.

This also stops the design rotting the way standing permissions
generally do. Without it, the reminder becomes a thing that is sent
rather than a thing that arrives, and the switch stays on for years
behind a dead address.

## Decision — 6: cadence is per-consent and anchored to the grant, not a monthly blast

Each consent's reminder is due one month after it was granted, then
monthly from there — not on the 1st for everybody. A single scheduled
sweep finds due reminders and sends them, so a family that opted in on
the 20th hears on the 20th, and a family that opted in yesterday does
not get an email today.

The sweep reuses
`backend/src/common/scheduling/scheduled-job-run.util.ts`'s
`tryClaimScheduledJobRunOrSkip` — the claim helper that was extracted
once six copies of it existed — rather than adding a seventh. Sending
must be idempotent per (consent, period): a double-claimed run that
mails every parent twice would be exactly the kind of alarming duplicate
that teaches people to ignore the email.

## Decision — 7: the six copy surfaces state a conditional, rather than losing the guarantee

ADR-0019's blocking consent-copy prerequisite identified six live
surfaces promising team-only visibility: the consent page templates (16
strings), `clips.json`'s child-facing explainer in all 8 locales, the
ToS draft, the code-of-conduct draft, `site/index.html`'s "Slutna
lagbubblor" trust card, and `docs/PROJECT.md` /
`docs/design/phase3-flows.md`.

Because Decision 1 makes this opt-in and default-off, those claims do
not become false — they become **conditional**, and the correction is to
say so rather than to delete the guarantee. `site/index.html`'s *"som
standard, inte som inställning"* is the sharpest case and the one that
shows the design is honest: under this ADR it stays literally true,
because team-only remains the default and public sharing is only ever
reached by a parent's affirmative act.

Two surfaces need more than a conditional clause:

- **`clips.json`, the child's own explainer**, must reflect *this
  child's current state* rather than the general rule. A child whose
  parent has enabled sharing should not be reading "only your own team
  can see this". This is the one place where a static string cannot be
  made truthful, and it is also the one place the reader is a
  nine-year-old.
- **The privacy policy draft** (`docs/legal/privacy-policy-DRAFT.md`)
  already anticipates this exactly, in its own open question 5:
  *"Publishing a child's clip beyond their team would need fresh
  consent, and this document must be updated before that ships, not
  after."* Decision 1 is that fresh consent. The document still has to
  be updated, and still before shipping.

**This does not close ADR-0019's prerequisite.** It narrows it to a copy
task with a defensible shape. Whether it is *legally* sufficient is
Open Question 5 below and belongs with the lawyer, not with this ADR.

## Decision — 8: the CLAUDE.md sentence this design needs is narrower than the one ADR-0019 proposed

Still owner-only — no agent in this repo may make this edit or proceed
as though it were made. But the double gate in Decision 3 means the
amendment can be tighter than ADR-0019's suggested wording, and the
tighter version is worth having because this sentence is what every
future agent will be held to:

> *"Closed team bubbles — no data/video/comments public by default; a
> user only ever sees their own verified team, except for individual
> clips whose publication the uploader's own parent has both enabled at
> the account level (ADR-0030) and approved for that specific clip
> (ADR-0019)."*

The clause names both gates and names the parent as the only actor, so
the sentence itself refuses the captain-publishes and team-toggle
variants that ADR-0007, ADR-0010, ADR-0019 Decision 2 and ADR-0029
Decision 9 have each already rejected.

## Consequences

- ADR-0019 remains the design of record for the feature itself. This ADR
  adds a gate in front of it and changes none of its eight decisions.
- One new entity, account-scoped, with its own approval/revoke codes; one
  scheduled sweep; one email template. No change to `VideoClip`.
- The reminder is now a **safety-critical scheduled job**: if it stops
  running, Decision 5's auto-disable also stops, and consents that
  should have lapsed stay live. It needs the same monitoring as the
  retention sweeps, not less.
- Every current family's team-only promise stays true unless they act.
- Nothing here reduces what ADR-0019 must still do before shipping.

## Open questions — flagged, not answered

1. **Moderation at volume.** A published clip is visible to children
   outside the uploader's team, which means strangers' children. ADR-0019
   Decision 4 provides reporting and an auto-revoke on report, which is a
   reactive control — someone has already seen it. Operator pre-review
   is the obvious alternative and does not survive contact with volume:
   the trainer-post queue works because adults post text occasionally.
   Neither answer is chosen here.
2. **What a child sees of a stranger.** ADR-0019 Decision 3 strips
   `teamName` and never resolves `taggedPlayerId`, so a viewer sees a
   clip and a screen name. Whether even that is right for a nine-year-old
   viewing an eleven-year-old they cannot otherwise reach is untested.
3. **Reporting and takedown from the viewer's side.** ADR-0019 Decision 4
   covers the mechanism. What it does not cover is the *reporting child's*
   parent — whether they hear anything, and what a report costs the
   reporter socially.
4. **Age gating, and the 13+ self-verification cohort.** ADR-0019 already
   named this its hardest question. A 13-year-old who self-verified has
   no parent in the loop, so there is no address for the monthly reminder
   and no one to disable it — which means Decisions 2, 4 and 5 have no
   actor for that cohort. The honest options are excluding them from
   public sharing entirely, or requiring a parent contact specifically
   for this consent even where account creation did not. Not decided.
5. **Legal basis, and whether this re-consent is sufficient.** Belongs
   with the lawyer already engaged for `privacy-policy-DRAFT.md`,
   alongside its open questions 2, 3 and 5. Specifically: whether an
   affirmative, revocable, separately-obtained parental consent is a
   sound basis for publishing a child's video beyond the closed group it
   was collected for, and whether the Swedish 13-year age of digital
   consent — which the app's 8 locales already outrun — changes the
   answer for non-Swedish users.
