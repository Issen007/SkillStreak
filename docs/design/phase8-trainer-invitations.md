# How a team reaches a trainer

Design note, 2026-08-10. Answers a question raised by the project owner:
emailing a code to a trainer is fine when the team knows who the trainer
is — but what if they don't? Could the team send a request the trainer
answers?

Short answer: yes, and it does **not** break the invariant people usually
assume it would. But there are two different "unknowns" hiding in the
question, and only one of them is buildable today.

---

## The fact that shapes everything below

**The captain who generates a trainer invite is a child.**

`PtTeamLinksController` is guarded by `JwtAuthGuard` and identifies the
caller with `@CurrentPlayerId()`; `assertIsCaptainOfTeam` then checks
`player.isCaptain`. A captain is a `Player` — one of the nine- to
thirteen-year-olds the app is for, with approved parental consent, but a
child. There is no adult role attached to a team at all.

So every option below is really the question *"what may a twelve-year-old
do to bring an adult into contact with their team?"* — which is a
different question from *"what may a club administrator do?"*, and the
answer has to be argued on those terms.

What makes this tractable rather than alarming is a property the system
already has: **an active team link on its own is nearly powerless.** It
shows the team name, the pot total, the weekly goal, and the roster's
*screen names* with each player's consent status. Every piece of actual
training data requires a separate, per-player, parent-granted consent
(ADR-0023 Decision A3/A5). A captain who links the wrong adult has
therefore not exposed a single child's data, and any of three people can
undo it (ADR-0023 Decision A4).

That is the safety margin the rest of this design spends.

---

## Two unknowns, not one

**Unknown A — "I have their email, but I don't know them."** The club
posted a coach's address; someone was recommended second-hand. The team
can already reach them; what's missing is a delivery channel.

**Unknown B — "I don't know anyone at all."** The team needs to *find* a
trainer. That is discovery, and discovery means a directory.

A is buildable now. B is the trainer marketplace, and needs its own ADR.

---

## Why a trainer directory does not break the invariant

ADR-0023 Decision A2 is usually summarised as "the team invites, never the
reverse". It is worth being precise about what that protects, because the
loose reading forbids more than it should.

The thing being prevented is **an adult browsing children**. A trainer must
not be able to search teams, see rosters they have no link to, or request
access to a child who has not invited them.

A directory of *trainers* is the mirror image: adults who have chosen to be
listed, browsed by teams. Nothing about it lets a trainer see a child.
Direction of initiation still runs team → trainer. **The invariant is not
"no discovery" — it is "children are never the browsable side."** A trainer
directory preserves it; a team directory would destroy it.

So Unknown B is not blocked on principle. It is blocked on something else:

**An unknown trainer is exactly the case where "is this person actually a
coach?" matters, and nothing in the system answers it.** With a known
trainer, the club's own knowledge is the verification. Remove that and
there is nothing — a stranger who lists themselves is indistinguishable
from a real coach. Per-player parental consent still gates all data, so
this is not a data-exposure hole; it is a *trust* hole, and it is what the
reputation/verification work in the backlog exists to fill. Building the
directory before the verification would be building the half that creates
the risk and skipping the half that manages it.

---

## Recommended model: one invitation, three ways to deliver it, one answer

Today a code is generated and redeemed. Redemption is immediate and
silent: the trainer types eight characters and is linked. There is no
moment where the trainer agrees to anything, and no state the team can see
between "code handed over" and "linked".

Replace the bare code with an **invitation** that has a status and must be
accepted. The delivery channel becomes a detail rather than a separate
feature:

1. **Hand over a code** — what exists today. Works with no email address
   at all, and offline. Keep it.
2. **Send it to an email address** — the same invitation, delivered by us.
   Covers Unknown A. *Build next.*
3. **Answer a listing** — the same invitation, addressed to a trainer
   found in an opt-in directory. Covers Unknown B. *Needs the
   verification ADR first.*

All three converge on the same screen: the trainer signs in, sees pending
invitations, and **accepts or declines**.

That explicit answer is worth building even for the code path that works
today, for three reasons:

- It creates a place to show the trainer *what they are agreeing to* —
  read-only, per-player consent, revocable at any time by the player, the
  parent or the captain, without explanation. Right now they agree to
  none of that, because nobody ever showed it to them.
- It gives the team a visible **pending / accepted / declined** state
  instead of silence. This is precisely the "send a request they can
  answer" the question asked for, and it turns out to be the same object
  in every channel.
- A decline is information. Silence is not.

---

## Constraints on the email channel (channel 2)

A child typing an arbitrary address into a box that makes our servers send
mail is the part that needs care. Not primarily because of spam — because
of what spam costs *us*:

> If skillstreak.xyz's sending reputation is damaged, the mail that stops
> arriving is the **parental consent email**. Consent mail is load-bearing
> for the entire child-safety model; a marketing domain being greylisted is
> an annoyance, but this one silently breaks the thing every other
> protection depends on.

That, rather than the nuisance value, is the reason to be strict:

- **Rate limit per team, not just per sender** — a small number of invite
  emails per team per day. Reuse the existing throttle idiom.
- **Nothing about a child in the email.** Team name, who invited them in
  the abstract ("the team captain"), and an accept link. No screen names,
  no roster, no counts.
- **Short expiry**, and single use — the invitation already behaves this
  way; keep it.
- **Don't reveal the address back.** The team should not be able to use
  invite-sending to confirm whether an address exists; the UI says "sent"
  either way.

**Should an adult have to press send?** I recommend not requiring it, and
the reasoning is worth recording because the opposite conclusion looks
safer at first glance. A captain can already hand a code to anyone — read
it aloud, text it, write it on paper. Requiring parental approval to
*email* a code they could trivially deliver another way would add friction
without changing who decides. The decision is already the captain's; what
we control is our own outbound mail, and that is what the limits above
constrain.

What *should* be added instead, because it is cheap and genuinely
protective: **notify when a trainer link becomes active** — the team, and
the parent contacts of players on it. Transparency after the fact beats a
gate that does not actually gate anything. A parent who learns a new adult
is attached to their child's team can revoke consent, or simply never
grant it.

---

## Channel 4 — the trainer asks first (raised by the project owner, 2026-08-26)

*"That should be something the trainer can generate in advance and
recommend to their future teams."*

Raised after signing in as a brand-new trainer and hitting
`drill_library_requires_team_link` — which is the gate working, and also
the whole new-trainer experience: sign in, and every useful tab is shut
until somebody else acts. A trainer approaching a club has nothing to
hand them.

**This does not break Decision A2, and the section above is why.** The
invariant is that children are never the browsable side, not that a
trainer must be passive. A trainer handing a club their own reference
exposes no child and lets no adult search anything.

But **the deciding act must stay with the team**, and that is the detail
that separates a good version from a bad one:

- **Bad: a trainer-generated code the captain redeems.** The link is
  created by the captain typing what an adult told them to type. The
  captain is a child, and a child following an instruction is compliance,
  not a decision. It also inverts today's meaning, where generating a
  code is the team affirmatively deciding it wants a trainer *before*
  anything exists.
- **Good: a trainer-generated invitation the team accepts.** The same
  invitation object channels 1-3 already converge on, created from the
  other end. The trainer hands over a reference; the captain sees a
  pending request naming who it is and what they would be able to see,
  and accepts or declines. Nothing exists until the team says yes, and a
  decline is recorded rather than silent.

The second is barely more work than the first once the invitation object
exists, and it is the difference between a team choosing and a child
complying.

### What still has to be answered

**Verification, and it bites harder here than anywhere else in this
document.** The section above says an unknown trainer is exactly where
"is this person actually a coach?" matters and nothing in the system
answers it. A trainer-initiated request is that case by construction: the
trainer arrives first, so the club's own knowledge cannot be assumed the
way it can when a captain has already decided to invite someone.

Two honest mitigations already in place, worth stating so this is not
read as more dangerous than it is: a team link alone still exposes almost
nothing (team aggregates, screen names, consent status), and every piece
of a child's data still needs that family's separate approval.

So the scope that is safe now, and the scope that is not:

- **Safe now: a known trainer approaching a club that already knows
  them.** The reference is a business card, and the out-of-band vouching
  that makes today's flow safe still happens — it just happens in a
  conversation rather than through the direction of a code.
- **Not yet: a stranger with a link.** That is the directory case wearing
  different clothes, and it needs the verification work first.

Nothing in the mechanism distinguishes those two, which means the
distinction has to be carried by how the invitation is delivered and by
what the captain is shown before accepting — a `ux-designer` question,
not a schema one.

### Needs

An **ADR-0023 amendment** (this changes A2's mechanics, not just its
plumbing), then **security-reviewer**, blocking, per CLAUDE.md. Best
built alongside channel 2, since both need the same invitation object and
the same accept/decline screen — building either alone means building it
twice.

---

## What is not decided

- Whether declining should tell the team *who* declined, or only that the
  invitation ended. Leaning toward the latter — the same "no explanation
  owed" principle ADR-0023 A4 applies to revocation.
- Whether an invitation can be addressed to an email that already belongs
  to a staff account (probably yes, and it should just appear in their
  pending list rather than being emailed).
- Everything about channel 3: listing, verification, reputation. Its own
  ADR, not this note.
