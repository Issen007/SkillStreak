# 0030 - Revocable public-sharing consent: the standing switch and its monthly reminder

## Status


**Decision 12, 2026-08-31** — self-consent at 16 and above, opt-in, which
narrows Decision 10 rather than deleting it (under 16 is unchanged). The
shape is decided; implementation waits on a CLAUDE.md amendment and a
blocking security review. See the end of this file.

**Security-reviewer pass, 2026-08-17 — NOT a sign-off.** The consent
lifecycle was built (`backend/src/public-sharing/`) and reviewed. The
review returned **eight blocking findings and five advisory**, and its
verdict is worth quoting rather than paraphrasing: the implementation
claimed to mirror `pt-consent.service.ts` while dropping most of the
protections that make that file safe.

**Closed in the first remediation pass** (each pinned by a test that
would have passed before the fix):

1. **The approval code was returned to its own caller** and the module
   mailed nobody, so "child taps Enable" and "child's video may leave the
   team" were two in-process calls apart. Codes now leave only by email.
2. **No side-effect-free preview.** The only code-consuming helper
   mutated, so a corporate link scanner prefetching a URL could have
   granted the consent. `previewByReviewCode`/`previewByRevokeCode` added.
3. **Decision 10 was a single read that the shipped contact-change flow
   defeats.** A player can repoint the parent contact to an address they
   control, wait out the 24-hour grace, and approve their own consent.
   Now refuses while a change is pending, and freezes the granting
   address encrypted for the row's lifetime.
7. **Re-requesting silently replaced an active consent**, bypassing
   `deactivate()` — and with it ADR-0019 Decision 5's un-publish hook,
   leaving clips published with no consent behind them — while erasing
   the record that a parent ever approved. Now refused outright.
9. *(advisory)* A missing expiry read as "never expires" rather than
   "expired". Reversed to match PT.

**All blocking findings are now closed.** The last one went 2026-08-19:

- ~~**4 (blocking, and the hardest).**~~ **Closed 2026-08-19**, in two
  stages. The 2026-08-18 pass made `MailService` return a
  `MailSendResult` rather than void, surfacing recipients the SMTP server
  refuses at handoff and reporting an unconfigured mailer as *not sent*
  instead of silently succeeding — the two failure modes an in-process
  send can observe.

  The remaining one, and the one Decision 5 was actually written for, is
  the **asynchronous bounce**: a relay accepts mail for a dead mailbox on
  a live domain and bounces it later, out of band, invisible to the
  sending process. That is closed by the mechanism in **Decision 12**
  below — a dedicated bounce mailbox, polled and parsed for DSNs — chosen
  over a provider delivery webhook by the project owner on 2026-08-19.

  **The reminder sweep exists as of the same commit, and not before.**
  This ADR's requirement that finding 4 close first was not ceremony: a
  sweep built on handoff-only signalling would have reported healthy
  while the case it exists to catch went undetected.
- ~~**5 (blocking).**~~ **Closed 2026-08-18.** The migration now exists
  (`1787600000000-AddPublicSharingConsent`) and carries
  `ON DELETE CASCADE` on `player_id`, so account erasure removes the row
  rather than orphaning an ACTIVE consent with a live revoke code. It
  also adds a CHECK constraint asserting that an `active` row has both a
  `revoke_code` and a `last_reminder_at` — closing advisory finding 9's
  two latent states at the database rather than trusting the service: an
  active consent with no revoke code is a parent who cannot turn sharing
  off, and one with no `last_reminder_at` is invisible to the sweep
  forever.
- ~~**6 (blocking).**~~ **Closed 2026-08-18.** `approveByReviewCode`,
  `declineByReviewCode` and `revokeByRevokeCode` now run inside a
  transaction with `pessimistic_write` on a code-keyed row, matching PT.
  Mail is sent outside the transaction, so an SMTP round trip never holds
  a row lock.
- ~~**8 (blocking).**~~ **Closed 2026-08-18.** `request()` claims a
  15-minute burst cooldown and a 3-per-day cap, both after the validity
  checks and before anything is written or mailed. Tighter than the clip
  limits on purpose: a parent should receive at most a handful of these
  ever, so a legitimate user never meets the ceiling while a compromised
  session hits it immediately.
- **13 (advisory, but a real obligation).** `isActiveFor` is
  account-scoped and cannot enforce Decision 3's "only the child's own
  clips". **That obligation belongs to the ADR-0019 caller** and is
  recorded here so it is not discovered during integration.

Also noted as sound: no location capture, no PII in this module's logs,
no injection surface, adequate code entropy, and default-off with no
backfill. Codes are stored in plaintext columns — parity with PT rather
than a regression, but `review_code` could be hashed since lookup is by
exact match, while `revoke_code` cannot be, because Decision 4 requires
embedding it in every reminder. Worth recording as a deliberate
constraint.

**Proposed — 2026-08-15. Amended 2026-08-16 by the project owner:
Decision 3 is replaced by a deliberately simpler interim posture, and
the whole ADR is now explicitly time-boxed.** Design only. Nothing here
is built, and **blocking security-reviewer sign-off is required before
any schema, endpoint or screen exists**, per CLAUDE.md's standing rule
and for the same reason ADR-0019 carried it: this touches child media
leaving the team bubble, which is the highest-risk thing this project
owns.

**The 2026-08-16 amendment, in the owner's own framing:**

> *"When a underage person want to share content, they need to ask for
> approval from their parents and we send a verification email to the
> parent. They need to approve that, then we will remind them once a
> month that this is still active and they can any time disable it using
> the link below. As soon long they don't disable it, it will be enable
> and that person can share and of their own video any time they want
> to. This is something we need to work on but for now until we go
> Public in large scale let's do this until later."*

One consent event, one standing state, one monthly reminder — and no
per-clip step. Decision 3 as originally written required both; it now
records the interim shape and what was knowingly traded for it. This is
a scale-dependent decision with a stated expiry ("until we go Public in
large scale"), not a permanent one, and Decision 9 records how it gets
revisited rather than leaving that to memory.

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
re-publish anything that was un-published — under the amended Decision 3
the child must choose to publish those clips again, deliberately, one at
a time. A switch that silently restores an old audience is not a switch
anyone can reason about, and this is the one place the interim posture
must not simplify: "on" means *may publish from now*, never *republish
what was withdrawn*.

## Decision — 3 (amended 2026-08-16): the switch is the only gate — per-clip approval is deferred, not deleted

**Interim posture, owner's decision, valid until the app goes public at
large scale.** One gate:

| Gate | Scope | Who | Status |
|---|---|---|---|
| Public-sharing consent | account, standing | parent | this ADR |
| ~~Publish approval~~ | ~~one clip~~ | ~~parent~~ | **deferred — ADR-0019 Decision 1, not built** |

Once the parent approves, the child may publish **their own** clips,
any of them, whenever they choose, for as long as the consent stays
enabled. No second approval, no queue, no waiting on a parent who is at
work.

**What this trades, stated plainly so the revisit has something to read
back.** The original Decision 3 required both gates to defeat one
specific failure: a parent enables sharing in January for one clip,
forgets, and in June the child publishes something that parent would
never have agreed to. Under the interim posture that failure is
*possible*. What stands in for the per-clip gate is the monthly reminder
— the January decision is re-put to the parent twelve times a year, and
each reminder carries both the current count and a one-click disable.
That is a weaker control than per-item consent and is not pretended to
be an equal one. It is a considered trade at current scale, where the
population is a beta of known families and the operator knows the teams
personally.

**What does not change, and is not available to trade:**

- **Only the uploader's own parent ever decides.** Not a captain, not a
  coach, not the operator, not a team-level toggle. This is the property
  ADR-0007, ADR-0010, ADR-0019 Decision 2 and all three of ADR-0029
  Decision 9's rejected variants each defended independently, and
  simplifying the *number* of gates does not touch *who holds* them.
- **Only the child's own clips.** A standing consent lets a child
  publish their own material freely; it grants nothing over anyone
  else's, and a clip that shows another child is not the uploader's to
  publish under it. This is the boundary that keeps the interim posture
  from becoming the captain-publishes variant by accident.
- **Everything in ADR-0019 that is not Decision 1.** Anonymization
  (Decision 3), the fixed reaction vocabulary and reporting with
  auto-revoke (Decision 4), immediate un-publish (Decision 5), erasure
  (Decision 7) all still apply. Deferring the approval step does not
  defer the safety rails around what happens after publication.

**A note for the security-reviewer pass this ADR still needs.**
ADR-0019 was reviewed *with* per-clip approval in place, and its clearance
should not be read as covering a design without it. The interim posture
makes that pass more consequential rather than less, and the reviewer
should be pointed at this decision first.

## Decision — 4: the monthly reminder is a safety mechanism, and must read like one

While the switch is enabled, the parent receives an email once a month.
This is the owner's mechanism, and the design question is what it
contains.

**Under the amended Decision 3 this email is the only recurring control
in the entire design.** It is no longer a backstop behind a per-clip
gate; it is the gate, spread over time. Every requirement below is
therefore load-bearing rather than good practice, and "we'll tune the
email later" is not available as a shipping compromise.

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

**CLOSED 2026-08-18.** The project owner directed the amendment and it is
now live in CLAUDE.md, in the wording below. ADR-0019's owner-only
CLAUDE.md prerequisite is therefore satisfied; its *consent-copy*
prerequisite is not — see the note at the end of this decision. But the double gate in Decision 3 means the
amendment can be tighter than ADR-0019's suggested wording, and the
tighter version is worth having because this sentence is what every
future agent will be held to:

> *"Closed team bubbles — no data/video/comments public by default; a
> user only ever sees their own verified team, except for a player's own
> clips, which they may publish only while that player's own parent has
> an active public-sharing consent (ADR-0030)."*

Three things the sentence has to carry, and does: **the player's own**
clips (never another child's), **their own parent** (never a captain, a
coach, the operator or a team-level toggle — the variants ADR-0007,
ADR-0010, ADR-0019 Decision 2 and ADR-0029 Decision 9 each rejected
independently), and **while active** (the permission is a live state
that lapses, not a one-time event).

This wording matches the interim posture. When Decision 9's trigger
reinstates per-clip approval, the sentence needs *"and has approved that
specific clip (ADR-0019)"* appended — worth noting now, because that is
the moment the wording would otherwise be left describing the weaker
design.

**The other prerequisite is deliberately still open, and its timing
matters.** ADR-0019's review requires the "only your own team" claim —
live across six surfaces — to be corrected *"before or alongside shipping
this feature."* Alongside, not now: cross-team publishing does not exist
yet, so today that claim is simply true. Rewriting it into a conditional
while nothing can actually leave a team would make the copy *less*
accurate than it is, and would tell families their promise had weakened
before anything had changed. The correction lands in the same change that
builds ADR-0019's feed, and Decision 7 records what each of the six
surfaces needs.

## Decision — 9 (added 2026-08-16): the interim posture expires on a trigger and a calendar, not on someone remembering

"Until we go Public in large scale" is the right instinct and the wrong
kind of sentence to leave a safety trade resting on: it has no edge, so
it never trips, and the interim posture quietly becomes the permanent
one. Two mechanisms, because either alone fails.

**A. A named trigger.** Per-clip approval (ADR-0019 Decision 1) is
reinstated before whichever of these happens first — numbers proposed
here for the owner to set, not assumed:

1. The app is publicly installable beyond invited testers — open App
   Store or Play listing rather than TestFlight/internal distribution.
2. Any team joins that the operator does not know personally. This is
   the real substance of the trade: the interim posture is defensible
   because the operator can recognise every family in the beta, and it
   stops being defensible the moment that is no longer true.
3. Enabled consents pass ~50, whichever comes first.

**B. A monthly review, at the owner's request** (2026-08-16): *"remind
me again once a month if we should keep this way or change it for the
future."* The review asks three questions, and they are written down
because the answer "still fine" is only meaningful if the question had
teeth:

- Has any trigger above been met or come close?
- How many consents are enabled, and how many parents have actually
  disabled? A disable rate of zero across many months means the reminder
  is being ignored rather than read, and an ignored reminder is not the
  control Decision 4 claims it is.
- Has anything been published that per-clip approval would have caught?
  One instance is the argument for reinstating it, on its own.

## Decision — 10 (added 2026-08-16): sharing always requires a parent, including 13+ self-verified accounts

**Owner's decision, 2026-08-16**, confirming the reading of their own
"underage person" framing: *"Yes, sharing needs a parent even for the
13+ self-verified accounts."*

Age-banded self-verification (ADR-0002's addendum) lets a 13+ player
create an account without a parent in the loop. **It does not extend to
public-sharing consent.** Concretely:

- A self-verified account with no parent contact on file **cannot enable
  sharing**. The switch is not merely off — it is unavailable, and the
  UI says why rather than failing silently.
- To enable, the player supplies a parent/guardian contact, which is
  stored in `player_private_info` (encrypted, as the existing parent
  contact already is) and then goes through **the same mailed approval
  as Decision 1** — no lighter path because the account was
  self-verified.
- Everything downstream is then identical: the monthly reminder
  (Decision 4), the delivery-failure auto-disable (Decision 5), instant
  revocation (Decision 2).

**Why this is the right shape and not just extra friction.** Under the
amended Decision 3 the monthly reminder is the design's only recurring
control. An account with no parent contact has no recipient for it, so
admitting that cohort would have meant unsupervised publication outside
the team — not a weaker control, but none. Self-verification decides
*who may hold an account*; it was never scoped to decide *whose video
may leave the bubble*.

**The new weakness this introduces, named rather than buried.** The
parent contact is an email address asserted by a child who now has a
direct incentive to assert a convenient one — unlocking sharing. The
under-13 flow has the same theoretical hole, but there the address gates
the account's existence and is typically supplied by the parent
themselves; here it gates a privilege the child actively wants, which is
a materially stronger reason to enter a second address of their own.

**Interim mitigation, on the same logic as Decision 3's trade:** at
current scale the operator and coaches know the families, so a parent
contact added to a self-verified account for sharing purposes should be
**confirmed by the team's coach or the operator** before the approval
mail is sent. This leans on exactly the property the interim posture
already depends on, and it expires with it — Decision 9's triggers
should reinstate a stronger check at the same time they reinstate
per-clip approval. Flagged for the security-reviewer pass as the
sharpest question in this decision.

**Copy consequence.** `SELF_VERIFICATION_CONFIRM_COPY` — the 13+
cohort's own consent block, 8 strings, one of ADR-0019's six surfaces
and the one that ADR overlooked entirely — must now say that
self-verification covers the account and not public sharing. Folds into
Decision 7's copy work rather than adding a separate task.

## Decision — 11 (added 2026-08-18): the rollout is an allow-list of team ids, not a feature boolean

`PUBLIC_SHARING_ENABLED_TEAM_IDS` — comma-separated team ids, empty by
default, read once at boot by `PublicSharingAccessService`. A team not on
the list cannot publish, cannot see the public feed, and cannot even ask
for a consent: `POST /me/public-sharing/request` refuses before any mail
is sent, since asking a parent to approve a feature their child's team
cannot use would be requesting consent to nothing.

**Why a list rather than a boolean, which is the whole point.** The
project owner asked for the feature to default ON during TestFlight
testing. A server-side boolean cannot deliver that: TestFlight builds use
the `production` EAS profile and therefore talk to `api.skillstreak.xyz`,
the same cluster serving the live beta. "On for testers" and "on for
every family" would have been the same switch, and the second is not what
was asked for.

**Why that mattered enough to change the design rather than accept it.**
When this was written, finding 4 was open — the monthly reminder could
not detect an asynchronous bounce, so a consent behind a dead parent
address stayed live indefinitely. Decision 9 argued the interim
single-gate posture is defensible *at small scale, among families the
coach knows personally*. The allow-list is that argument made mechanical:
it is not a test harness that happens to limit exposure, it is the
boundary of the reasoning this ADR already committed to.

*Updated 2026-08-19: finding 4 is now closed (Decision 12), which removes
one of the two arguments for keeping the list narrow. **The other one
stands.** Decision 9's "small scale, among families the coach knows" is
independent of bounce detection, so removing the gate still belongs with
that review — due 2026-09-16 — rather than with finding 4's closure.*

**Empty means nobody, deliberately.** A misconfigured or forgotten
deployment must fail toward no child sharing, never toward all of them.
The env var is declared `@IsOptional()` **without** `@IsNotEmpty()` — that
pair is a trap this repo has hit before, since `@IsOptional()` only skips
`undefined`/`null` and a ConfigMap key present-but-blank would crash the
pod at boot. Here blank is not a misconfiguration; it is the off switch,
and the expected production value for now. `env.validation.spec.ts` holds
a regression test for exactly that.

## Decision 12 — bounce detection is a polled mailbox parsed for DSNs

*Added 2026-08-19. Closes finding 4, and is what let Decision 6's
reminder sweep be written at all.*

The choice was between the two options finding 4 itself named: a bounce
mailbox parsed for DSNs, or a mail provider with a delivery webhook. The
project owner chose the mailbox on 2026-08-19.

**Why it is the better fit here regardless.** A webhook is a
provider-specific integration, and this app's provider is explicitly
interim — Gmail SMTP, recorded as such in the privacy policy. Building
against a webhook would have meant either committing to a provider
before the mail story is settled, or writing an adapter for a provider
we do not have. A DSN is a standard (RFC 3464) that every MTA emits, so
the parser survives the provider change that is coming anyway.

### How it works

1. Every monthly reminder carries a random per-send **correlation
   token**, stamped twice: as an `X-SkillStreak-Consent` header, and as
   the local part of the `Message-ID` (`<psc.{token}@domain>`). Two
   places because MTAs differ in which they return with a failed
   original — several strip `X-` headers, almost all preserve
   `Message-ID`.
2. `BounceMailboxService` polls a dedicated IMAP mailbox hourly, behind
   the same cross-pod Redis run-claim every other scheduled job here
   uses.
3. `dsn.parser.ts` parses each message. A **permanent** failure requires
   `Action: failed` **and** a `5.x.x` status — both, because MTAs exist
   that send `failed` with a 4.x.x on a final retry, and others that
   report a 5.x.x on a `delayed` notice. Requiring both is what keeps a
   temporarily unreachable parent from being counted as a dead address.
4. The token is recovered from the returned original headers and handed
   to `recordReminderUndeliverable`, which counts it toward Decision 5.

### The counter had to change shape, and this is the subtle part

Decision 5 disables after **two consecutive undeliverable reminders**.
The obvious implementation — reset the failure count whenever a reminder
goes out — is unimplementable against an asynchronous signal, because
the bounce arrives *days after* the send. The sequence would run:

> send → reset to 0 → bounce → 1 → send → reset to 0 → bounce → 1 → …

forever. The disable could never fire, no matter how permanently dead
the address was. A job that looked like it was working.

So the counter is settled **one send late, by construction**: a send can
only judge the reminder *before* it, whose DSN has by now either arrived
or not. `sendReminder` asks "did the previous reminder bounce?" and
carries or clears the streak accordingly. Silence is the only positive
delivery signal SMTP offers, and here it is legitimately treated as one.

**Attribution is by token, not by timestamp.** The first implementation
compared `last_reminder_bounced_at >= last_reminder_at` to decide whether
a bounce had already been counted. That is wrong whenever a send and a
bounce land on the same instant — a duplicate DSN in the same tick, two
pods with skewed clocks — because the second *genuine* bounce then reads
as a duplicate of the first and is dropped, leaving live exactly the
consent that should have been disabled. `last_reminder_bounced_token`
identifies exactly one send, so the comparison is total. The timestamp
is kept for audit only.

### Residuals, stated rather than discovered later

- **Attribution is token-only.** A DSN returning neither our header nor
  the `Message-ID` cannot be attributed and is counted, logged and
  otherwise ignored. Matching on the recipient address instead was
  considered and rejected: siblings on the same team share one parent
  address, so a recipient match cannot say *which* consent, and acting on
  it would revoke a consent a parent granted on evidence that does not
  identify the family. The unattributed count is logged every run, so how
  often this actually happens becomes a measurement — and that number,
  not speculation, is what should justify building a fallback.
- **A late DSN for a superseded reminder is ignored.** Once the next
  month's reminder has gone out, the previous token no longer matches.
  Pinned by a test so it stays a known behaviour.
- **The mailbox holds credentials.** A DSN quotes the message that
  failed, and a reminder contains the parent's revoke link — so this
  mailbox accumulates live revoke codes. It wants a dedicated account,
  messages are deleted once read, and nothing from a body is logged or
  persisted. The exposure is bounded by direction (a revoke code only
  ever turns sharing *off*, which is the safe way for this particular
  secret to leak) but bounded is not nil.
- **A spoofed DSN can disable a consent.** Anyone can send mail to the
  mailbox. Forging one requires guessing a 24-byte random token, and the
  parser refuses anything without a well-formed per-recipient status
  block rather than trusting the `report-type` parameter a forger would
  set. The failure direction is also the safe one: the worst outcome is
  that a child's sharing is switched off.
- **While the mailbox is unconfigured, the gap is loud rather than
  silent.** The poll skips, and the reminder sweep names how many
  consents are running unsupervised — an error-log row on every run once
  any consent exists, and a plain warning while the count is zero, since
  an error a day saying nothing is wrong is how the one channel that
  reports this gap gets ignored. Reminders still go out, because the
  revoke link inside them is a parent's only standing lever and
  withholding it would remove a control rather than add one.

### Security review, 2026-08-19 — three blocking findings, all fixed

The first implementation of this decision did not survive review. Each
finding is recorded because each one is a way this control could have
looked healthy while doing nothing — the same failure shape as finding 4
itself.

1. **The synchronous evidence path could never reach the threshold.**
   `sendReminder` settled the streak by asking whether the previous
   reminder had failed, and that question is answered by a token — but a
   refusal at SMTP handoff incremented a counter without recording one.
   The next send therefore saw no failure against the previous reminder
   and reset the count. Six months against a permanently refused address
   produced `[1,1,1,1,1,1]` and left the consent ACTIVE — and a 550 at
   RCPT TO is the *most common* dead-mailbox case on domains that reject
   synchronously. The bug this Decision exists to fix, surviving on the
   other evidence path. **Fixed** by recording both kinds of evidence
   against the reminder's token through one method; the columns are now
   `last_reminder_failure_*` rather than `..._bounced_*`, because
   Decision 5 says *undeliverable*, not *bounced*. The tokenless
   `recordReminderFailure` is deleted rather than deprecated.

2. **The sweep could resurrect a consent a parent had just revoked.**
   `sendReminder` operated on an entity loaded at the top of the sweep,
   possibly minutes stale, and wrote it back with `save()`. TypeORM diffs
   against the current row and writes every differing column, so a revoke
   landing in that window was overwritten: `status` back to `active`, the
   old revoke code restored, `revoked_at` nulled — after the parent had
   been told sharing was off. Confirmed against real Postgres. **Fixed**
   by replacing the whole-entity save with a conditional
   `UPDATE … WHERE id = ? AND status = 'active'`, so the write loses that
   race instead of winning it, and by moving the failure intake into a
   `pessimistic_write` transaction like the other mutating paths.

3. **One email could pin the API's event loop for hours, and re-pin it
   every hour.** The multipart splitter ran `/[\r\s]+$/` over every body
   line; that pattern backtracks quadratically on a whitespace run
   followed by a non-space (27ms at 10k chars, 1.8s at 80k, minutes at
   1MB). Anyone who knows the bounce address can send one — every parent
   does, since it is the envelope sender of their own reminders. It was
   also self-renewing: imapflow fetches with `BODY.PEEK`, so nothing was
   ever flagged `\Seen`, and deletion happened only after the whole loop
   completed, so a message that hung or threw was re-read forever with
   every real bounce queued behind it. **Fixed** with `trimEnd()` (native,
   linear), a 256 KiB bounded fetch, a per-run message ceiling,
   per-message deletion immediately after success, and an explicit
   `\Seen` flag on the failure path so a poisonous message is skipped
   next run rather than retried forever.

Three advisory findings were also fixed: a correlation token surviving a
revoke → re-request → approve cycle, so a straggling DSN about the old
grant was charged against the new one; `BOUNCE_IMAP_PASSWORD` missing
from `k8s/api-deployment.yaml`, which wires Secret keys individually — so
the mailbox could never have been switched on as documented; and the
"running unsupervised" alarm sitting *after* the sweep's early return, so
it only fired on days a reminder happened to fall due. The recipient
address is also no longer logged when SMTP is unconfigured.

**One residual the review raised and this ADR does not close:**
`messageDelete` issues `\Deleted` + `UID EXPUNGE`, which on Gmail /
Workspace removes the INBOX label but leaves the message in All Mail
unless the account is configured to delete forever. Since deletion is the
whole mitigation for "this mailbox holds live revoke codes", **the
account's IMAP deletion behaviour must be verified when it is
provisioned** — a configuration step, not a code change, and it is listed
with the provisioning task.

### What this does NOT change

Decision 9's `PUBLIC_SHARING_ENABLED_TEAM_IDS` allow-list stays as it is.
Finding 4's closure removes one of the arguments for keeping the rollout
narrow, but not the other: Decision 9 also rests on "small scale, among
families the coach knows personally". Widening belongs with that review,
due 2026-09-16, not with this commit.

## Consequences

- **ADR-0019 remains the design of record for the feature itself, with
  its Decision 1 deferred for the interim period.** Its other seven
  decisions are unchanged and still apply. This ADR no longer adds a
  gate in front of ADR-0019 — it temporarily replaces ADR-0019's gate
  with a coarser one, which is a reduction in control and is recorded as
  such.
- One new entity, account-scoped, with its own approval/revoke codes; one
  scheduled sweep; one email template. No change to `VideoClip`.
- **Decision 10 adds a flow that did not exist: attaching a parent
  contact to an already-created self-verified account.** This is not
  free — it writes to `player_private_info` after account creation, and
  it needs the coach/operator confirmation step. Worth scoping
  separately from the switch itself, since it is the one part of this
  ADR with no existing shape to copy.
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
   actor for that cohort.

   **The amended Decision 3 makes this sharper, and close to
   self-answering.** When the reminder was a backstop behind per-clip
   approval, a cohort without a reminder recipient still had one control.
   Under the interim posture the reminder is the *only* control, so that
   cohort would have **none at all** — self-verified account creation
   would silently become unsupervised publication outside the team.

   **Answered 2026-08-16 — see Decision 10.** Sharing requires a parent
   for every underage player, whatever route created the account; a
   self-verified account with no parent contact cannot enable it. What
   remains open is not the rule but its weakest joint: **how a
   parent contact supplied by a motivated 13-year-old is verified.**
   Decision 10 proposes coach/operator confirmation as an interim
   measure resting on the same "we know the families" property as
   Decision 3, and hands it to the security-reviewer pass as that
   decision's sharpest question.
5. **Legal basis, and whether this re-consent is sufficient.** Belongs
   with the lawyer already engaged for `privacy-policy-DRAFT.md`,
   alongside its open questions 2, 3 and 5. Specifically: whether an
   affirmative, revocable, separately-obtained parental consent is a
   sound basis for publishing a child's video beyond the closed group it
   was collected for, and whether the Swedish 13-year age of digital
   consent — which the app's 8 locales already outrun — changes the
   answer for non-Swedish users.

---

## Decision — 12 (PROPOSED 2026-08-31): self-consent above the digital-consent age — opt-in only, and it reverses Decision 10

**Status: proposed, not decided.** Raised by the project owner
2026-08-31: *"for people who is older then a age of EU says we can share
content without asking our parents for permissions. Then it will be
automatic availible but we can put the option to disable that option."*

**This reverses Decision 10**, made two weeks earlier and quoting the
owner's own words: *"Yes, sharing needs a parent even for the 13+
self-verified accounts."* Recorded here rather than silently superseded —
changing your mind is fine, doing it without seeing the earlier argument
is not.

### The half of Decision 10 that no longer holds

Decision 10's central argument was mechanical rather than moral:

> An account with no parent contact has no recipient for [the monthly
> reminder], so admitting that cohort would have meant unsupervised
> publication outside the team — not a weaker control, but none.

**That assumed the reminder must reach a parent.** It need not, if the
consent is the player's own. `player_private_info.parent_contact` is
non-nullable and a self-verified account already receives its own
verification mail, so a recipient exists — it is the player. A monthly
"your clips are still public, here is how to stop" sent to a
seventeen-year-old who chose to publish is a real control, not an absent
one.

So Decision 10's strongest argument is weaker than it looked, and the
proposal deserves a serious hearing rather than a reflex no. **Confirm
before building** that a self-verified account's stored contact is in fact
the player's own address and not a parent's — the column name says parent
and the semantics may differ per cohort.

### The half that stands, and it is fatal to "automatic"

**"Automatically available with an option to disable" is a pre-ticked box,
and a pre-ticked box is not consent.** GDPR Article 4(11) requires a clear
affirmative action; Recital 32 rules out silence, pre-ticked boxes and
inactivity by name, and the CJEU said the same in *Planet49*.

This codebase already knows it. `site/index.html`'s signup form carries
the reasoning in a comment, for two marketing checkboxes. Defaulting a
teenager's video to publishable outside their team is the same mistake in
a place where the cost is incomparably higher.

**Whatever else is decided, the switch starts off.**

### The second problem, which no amount of copy fixes

`player.birth_year` is self-declared and **nothing verifies it**. Today
that is tolerable, because the number only decides whether a parent is
asked for the *account* — Decision 10 means it cannot unlock publication.

This proposal would make that unverified number the thing that lets a
child publish video of themselves to strangers with no adult ever
involved. A twelve-year-old enters 2005 and the system cannot tell.
BACKLOG.md already states the rule this breaks: *"The age bar cannot be
the safety control."*

Under Decision 10 a child wanting to bypass a parent must at least supply
a plausible address and receive mail at it — weak, and named as weak in
Decision 10 itself, but not nothing. This proposal removes even that.

### The shape that gets what was asked for

1. **Self-consent for players at or above `SELF_VERIFICATION_MIN_AGE_YEARS`**,
   granted by the player, recorded in the same `public_sharing_consent`
   row, revocable identically. A seventeen-year-old stops needing a parent
   to share their own training video, which is the real and reasonable
   ask.
2. **Opt-in, never default.** Same affirmative act as every other consent
   here.
3. **The monthly reminder goes to the player**, and the
   delivery-failure auto-disable (Decision 5) applies unchanged — so the
   design keeps its only recurring control rather than losing it.
4. **Decide the age deliberately, and do not assume 13.** Article 8's
   thirteen is about a service processing a child's data. Publishing
   video of a child's face to strangers is a different act with a
   different risk, and a higher bar for it is lawful and defensible. 15,
   16 or 18 are all arguable; 13 is the floor for the wrong question.

### Decided 2026-08-31 by the project owner

**The age is 16**, not Article 8's 13. Under 16, sharing needs a parent
exactly as Decision 10 requires; at 16 and above the player may consent
for themselves. Consistent with the backlog's account-linking entry, which
already chose 16 for player-to-trainer linking — so the app has one "old
enough to act for yourself" age rather than two that will drift.

**The switch is unlocked, not flipped.** At 16 the capability becomes
available with no parent in the loop, and the player turns it on
themselves. A 16-year-old who never touches the setting shares nothing.
This is what makes it consent rather than a pre-ticked box.

### Age integrity — the owner's proposals, and what each one costs

Raised together 2026-08-31, because a self-declared year that now unlocks
publication needs something behind it.

**1. The birth year is immutable — adopted, and already true.** No update
path exists in the API and the profile screen renders it as text, not a
field. So this is a property to *state and defend* rather than build.

**But it cannot be immutable without exception, and this is the one
correction that matters.** GDPR Article 16 gives every data subject the
right to have inaccurate personal data rectified. A picker mis-tap that
can never be corrected is a permanent inaccuracy the subject has a legal
right to fix — and it is a young child's data.

The shape that satisfies both: **immutable to the user, correctable by the
operator on request, with the correction recorded.** Anti-gaming survives
(a child cannot quietly bump their own year to reach 16) and Article 16
survives with it. A correction that crosses the 16 boundary should
additionally revoke any self-consent it retroactively invalidates.

**2. Say in the terms that the age must be true — adopted, with a caveat
worth stating.** A term requiring truthful age is standard and worth
having. It does **not** transfer responsibility: under GDPR the controller
remains responsible for the processing whatever the child typed, and a
term is not a defence to processing a 12-year-old's data as if they were
16. It supports good faith; it does not discharge the duty. Write it,
and do not rely on it.

**3. Flag teams with implausible ages — adopted, and it needs no AI.**
This is a scheduled SQL query, not a model: compare each player's year
against their team's median and flag outliers. Saying so is worth more
than building anything, because "an AI agent for it" is weeks and a
`HAVING` clause is an afternoon.

**Flag the outlier, not the spread.** A team evenly spanning 2010–2016 is
just a wide team; a team of 2014s with one 2005 is the thing worth
seeing. Raw spread would fire on the first and miss the shape of the
second.

**4. Five years maximum spread — NOT adopted as a rule.** It would break
real teams. Players 9–13 already span four years, and the backlog records
that *"sixteen- and seventeen-year-old assistant coaches are completely
normal in Swedish youth floorball"* — so a legitimate roster reaches seven
or eight years routinely. A hard cap would reject those teams and teach
everyone that the rule is wrong.

Keep it as a **threshold for flagging**, generous enough that firing means
something. Start around eight years and tune on real teams, in exactly the
way ADR-0036 says a classifier threshold must be tuned rather than
guessed.

**5. Notify other members' parents about an older person — NOT adopted,
and this one should not be built as described.** It discloses one child's
age to a dozen other families, automatically, on a signal that is wrong
most of the time. The commonest cause of an older player on a youth roster
is the legitimate one above — and the notification would out a real
seventeen-year-old assistant to every family in the team, repeatedly, for
doing nothing.

**Route it to the operator instead**, which is the same shape as every
other control in this codebase: the machine flags, a human decides, and
the human decides whether any family needs telling. If a genuine problem
is found, telling parents is then a considered act by a person rather than
an automatic disclosure by a query.

### Coach confirmation does not work, and the reason generalises

Raised by the project owner 2026-08-31: a team that hires a professional
trainer gets an adult *who has never met the children*. That trainer
cannot confirm anyone's age, and will not know it until well after the
relationship starts.

**It is worse than that, and worth stating plainly: this app contains no
adult who reliably knows the children's real ages.**

- The **captain is a child** (ADR-0028 Decision 5 states it outright).
- A **PT is a stranger by design.** ADR-0023 built the role so that a team
  link on its own exposes screen names and consent status and nothing
  else — a PT can see *who exists to ask*, never who anyone is. Not
  knowing the children is the feature.
- Phase 2's kapten pivot removed adult accounts entirely.

So Decision 10's interim mitigation — *"confirmed by the team's coach or
the operator"* — has a weak half and a strong half, and only now is it
clear which is which. **The coach half does not hold.** The operator half
does, at current scale, because the operator knows the beta teams
personally; it is already labelled interim and it does not scale.

### What actually reaches someone who knows

**1. The outlier flag already covers the main abuse shape**, and this is
the useful realisation. A twelve-year-old who types 2010 to unlock sharing
*is* an age outlier in a team of real twelve-year-olds — which is exactly
what the adopted flag looks for. The detector and this problem are the
same problem, and it was already adopted for other reasons.

Where it does not help: a whole team faking together, or a genuinely
mixed-age roster the faker blends into. Those are real gaps and neither is
closed here.

**2. Notify the contact on file when a 16+ self-consent is switched on.**
Not approval — that would undo the decision above. Visibility. If the
address belongs to a parent, someone who knows the child's real age
learns that sharing was enabled, and a parent who knows their child is
twelve will react.

**Traced 2026-08-31, and the answer kills it.** Both onboarding branches
write `dto.parentContact` into the same column; only the label differs.
Under 13 the app asks for *"Förälders eller vårdnadshavares e-post"*. At
13+ it asks for *"Din e-post eller mobilnummer"* — **the player's own**.
The column name is a leftover from when there was one branch.

So notifying "the contact on file" would email the person who typed the
age, including the twelve-year-old who typed 2010. Not a weak control: one
that notifies the subject of its own suspicion. **Rejected.**

### DECIDED 2026-08-31 — accept the residual risk, and name it

Project owner's call, after the trace above removed the last candidate
control.

**What is accepted, in plain words.** A child who enters a false birth
year reaching 16 can enable public sharing of their own clips with **no
parent involved at any point**. No parent address is ever collected for
such an account, so there is nobody to notify — not for this, not for
anything, ever. The only thing that might catch it is the outlier flag.

**Why this is tolerable now, and it is not "because it is unlikely".**

- **Layer 3 stands in front of it.** Since 2026-08-27 no clip reaches a
  stranger without an operator watching it
  (`docs/design/clip-safety.md`). So the failure is not "a twelve-year-old
  publishes to strangers unchecked" — it is "publishes with human review
  but without parental consent". That is a real consent failure and a
  materially smaller safety one, and the distinction is the reason this is
  acceptable rather than reckless.
- **The outlier flag catches the common shape.** A twelve-year-old
  claiming 16 among real twelve-year-olds is exactly the anomaly it looks
  for.
- **Public sharing is currently off entirely** — one team on the
  allow-list, consent revoked. Nothing is exposed today.

**The gaps that remain, with nothing behind them:** a whole team entering
false years together, and a genuinely mixed-age roster a faker blends
into. Neither is closed and neither is closeable without verified
identity, which the backlog's account-linking entry already parks as its
own decision.

**Reopen on any of these:**

- Public sharing widening beyond the current one-team allow-list.
- The outlier flag firing on a real case — the first true positive is
  evidence about the rate, which nobody has.
- Scale at which the operator no longer knows the teams personally, since
  that is what the whole interim posture rests on (Decision 9's triggers).
- Any incident involving a misstated age.

### Still open

- **What the terms say about a false age** — the lawyer's wording rather
  than this document's, and now carrying more weight, since it is the only
  remaining response to a child who lies about their year.
- **Renaming `parent_contact`**, which no longer describes what it holds
  for 13+ accounts. Cosmetic until someone trusts the name.

### Before any of Decision 12 is built

A **CLAUDE.md amendment**, since the non-negotiable reads *"their own
parent"* with no exception, and a **blocking security-reviewer pass**.
- **What the terms actually say** about a false age, which is the lawyer's
  wording rather than this document's.

### Needs

An explicit **CLAUDE.md amendment** — its non-negotiable names *"their own
parent"*, and this changes that sentence for one cohort — plus a
**blocking security-reviewer pass**, per the standing rule for anything
touching child media or consent.

