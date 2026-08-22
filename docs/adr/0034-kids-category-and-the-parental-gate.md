# 0034 - Ship in Apple's Kids Category, behind a parental gate

## Status

Accepted 2026-08-22. Project owner's decision, closing
[`LAUNCH-CHECKLIST.md`](../LAUNCH-CHECKLIST.md) §2.1.

## Context

Both stores treat a child-directed app as its own regime, and Apple offers
two routes: the **Kids Category**, which is stricter, or a general listing
with an age rating, which is easier and says less about what the app is.

SkillStreak is built for 9–13-year-olds by a coach, and its entire
argument is what it does with children's data. Kids Category states that
plainly rather than leaving a reviewer to infer it.

## Decision 1 — Kids Category, accepting its rules

The rules that bind, and where this app already stands:

| Rule | Status |
|---|---|
| No behavioural advertising | No ads of any kind, no ad SDK |
| No third-party analytics | None in the dependency list |
| Verifiable parental consent before collecting from children | The consent flow predates this decision |
| **A parental gate before anything leaves the app** | **This ADR's Decision 2 — the one thing that needed building** |

## Decision 2 — One gate, in front of every exit

`components/ParentalGate.tsx`, applied to all five ways out of the app.
Three of the five are reachable by a child:

- the privacy-policy link on the profile screen;
- **the friend-invite share sheet** — a child sending a team invite;
- **the PT-link share sheet** — a captain, who is a child, sending a code
  to a trainer.

The other two (linking a trainer account, opening the staff console) are
adult paths that are not rendered below 13, and are gated anyway rather
than reasoned about case by case.

**The OS share sheet counts.** It is easy to read App Review 1.3 as being
about hyperlinks; it is about information leaving the app, and a share
sheet does exactly that. Missing those two would have been the likeliest
way to fail review while believing the rule had been followed.

## Decision 3 — Say what the gate is, and is not

**It is a compliance control, not a security one.** This app's users are
9–13. A thirteen-year-old can do arithmetic, and nothing rendered on their
own phone genuinely stops them. What the gate does is make leaving the app
a deliberate act rather than an accidental tap, and give a parent standing
to have set an expectation.

That is written in the component, not just here, because the alternative
is a future reader assuming it is stronger than it is and building
something load-bearing on top of it.

Given that, the challenge is chosen to be *awkward* rather than
impossible: a two-digit number (12–39) times one of 3, 4, 6, 7, 8 or 9 —
never ×1, ×2, ×5 or ×10, which a nine-year-old has memorised. 168 distinct
sums, re-rolled on every open and after every wrong answer, so it cannot
be learned by repetition. Free numeric entry rather than multiple choice,
which Apple has rejected before as beatable by tapping every option.

## Consequences

- Adding any new way out of the app means adding a gate. There is no
  lint rule for this; the audit is `grep -rn "Linking.openURL\|Share.share"`.
- The category is visible in the store listing, so the claim is public and
  has to keep being true — in particular, adding an analytics or ad SDK
  later would not merely change a form answer, it would break the
  category.
- Kids Category apps get more scrutiny at review, which is the trade being
  made deliberately: slower first submission, and a listing that says what
  this app is.
