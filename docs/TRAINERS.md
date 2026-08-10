# For trainers and coaches

You know what a good session looks like. SkillStreak is what turns it into
something a kid actually does on a Tuesday evening when you are not there.

---

## Three ways to build a week

**1. Let the AI draft it.** Describe what you need in plain language —
*"a fun 15-minute fitness session for 11-year-olds, no equipment"* — and
you get a finished session back. Adjust it, send it, done. This is for the
Tuesday when you have twenty minutes between work and practice.

**2. Bring your own.** Your drills, your progressions, your years of
knowing which warm-up actually works for this age group. Build the week
from your own material and the app handles the rest: who logged it, who is
on a streak, who has quietly stopped showing up.

**3. Use someone else's.** A session another trainer built and shared,
adapted to your group. Good coaching has always spread by being copied.

Nothing here asks you to be a content creator. It asks you to be a coach,
and then makes what you already do reach further.

---

## Help one team, or many

You can work with your own team and stop there. Plenty of trainers will.

Or you can help teams that have no trainer at all — the ones where a
parent volunteered and is doing their honest best with a whistle and a
YouTube tab. Share your sessions with them for free. That is genuinely
worth something, and it costs you nothing you have not already made.

**And if you want it to be more than that**, the direction this is heading
is that a trainer who does great work can be recognised for it: teams you
help can say so, and that recommendation is what other teams see when they
are looking for help. A coaching reputation that follows the work rather
than the marketing.

> **Status, stated plainly:** the reputation and professional side —
> reviews from teams, a public trainer profile, anything paid — is **not
> built yet and not yet designed**. It is a direction, not a feature you
> can use today. See `docs/internal/BACKLOG.md`'s trainer-marketplace
> entry for what has to be decided first. Everything above the line is
> real; this paragraph is not, and this document will say so until it is.

---

## What you can actually do today

| Capability | Status |
|---|---|
| Get linked to a team by its captain, with a code | **Built** |
| See a team's roster, pot total and weekly-goal progress | **Built** |
| Request per-player consent to see a player's training | **Built** |
| See streaks, logged sessions and badges for approved players | **Built** |
| Sign in with Google, Microsoft or Apple | **Built** |
| A web console to do any of it in | **Not built** — see below |
| AI session generation | Designed, not built |
| Trainer profile, reviews, paid tier | Not designed |

**The honest blocker**: the backend for the trainer role is complete and
tested, and the screens are designed
(`docs/design/phase8-pt-flows.md`) — but there is no staff web console to
put them in yet. Signing in today succeeds and then shows you a page of
raw JSON, because there is nothing on the other side. That console is the
next thing that has to exist before any of this is usable by a real
trainer.

---

## How you will get linked to a team

This part is designed and built, and it is worth understanding now because
it is deliberately unusual.

**A captain invites you.** They generate a short code and give it to you;
you redeem it. You cannot search for teams or request access — that
direction does not exist, on purpose. A trainer cannot go looking through
the app for children.

**An active team link on its own shows you almost nothing**: the team's
name, its pot total, its weekly-goal progress, and the roster's *screen
names* with each player's consent status. That is who exists to ask. Not
their training.

**Each child is a separate yes.** You request access to one player; their
parent (or the player themselves, if they are 13+) gets an email and
decides. Only then do you see that player's streaks, logged sessions and
badges.

**Any of three people can end it, instantly, without asking you**: the
player, the parent, or the captain revoking your whole team link. You will
not be told why. That is by design — if a family changes its mind, they do
not owe you an explanation.

### What you will never see

Not "what we have not built yet" — what the app structurally will not show
a trainer:

- A player's real name or contact details
- Team chat
- Video clips of any kind
- Whether a player works with any other trainer
- Anywhere a child has been — the app records *that* a child trained,
  never *where*

If a name is greyed out, that is not a bug. It means that family has not
said yes, or has changed their mind.

---

## Why it works this way

Every one of those constraints costs a trainer something. They exist
because the alternative costs a child more.

This app is used by nine- to thirteen-year-olds. A parent who says yes is
trusting a system, not just you personally — and the fastest way to lose
that trust for everyone is one adult seeing something they should not.
The gates are what let a parent say yes at all.

You are also not being asked to be trusted blindly: you cannot message a
player, post to a team, or upload anything. The role is read-only. That is
a smaller job than "coach" — and it is the version of the job a parent
will agree to.

---

## Getting started

1. Ask the team's captain for a trainer code.
2. Sign in with Google, Microsoft or Apple — no separate password, no
   registration form. The account is created on first sign-in.
3. Redeem the code.
4. Request consent for the players you will actually be working with —
   not all of them by default.

Steps 2 and 3 need the web console that does not exist yet. Until it
does, talk to the project owner directly.
