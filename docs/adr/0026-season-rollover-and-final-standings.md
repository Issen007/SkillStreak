# 0026 — Year-end rollover, the reset, and final standings

## Status

Proposed, 2026-08-10. Extends `docs/adr/0008-vm-guld-cross-team-leaderboard.md`
and the season grid from `docs/adr/0009-self-service-team-creation.md`
Decision 6 (changed to full calendar years 2026-08-10).

**Nothing here is built.** Design first, because the reset touches the
number every child on every team looks at.

## Context — two things that are not what they appear

**1. Points have never reset, and would not have reset on 1 January.**

`TeamPoolService.getActivePotForTeam` resolves a pot by
`status = 'active'` and **nothing else** — no season filter, no date
filter. `createInitialSeasonAndPot` runs exactly once, when a team is
created. `TeamSeasonPotStatus.ACHIEVED` and `CLOSED` exist in the enum and
are **never set by any code**. There is no cron, no rollover, no close.

So a pot created in "Vår 2026" keeps accumulating in 2027, 2028, forever.
The season labels are decoration: they describe a window nothing enforces.

**2. Changing the season grid to full years did not change that.** That
change (2026-08-10) affects the *label* on newly created pots. It is
necessary for this design and does not, on its own, cause any reset.

So "reset on 1 Jan" is not a tweak to an existing mechanism. The mechanism
does not exist.

## Decision — 1: the rollover is lazy and season-scoped; correctness never depends on a job running

Pot resolution becomes "the pot for **this team, this season**", created on
first use if absent — rather than "any active pot for this team".

Rejected: a scheduled job that closes every pot and opens the next year's
at midnight. Not because cron is unavailable (this app runs four scheduled
jobs already) but because it makes **correctness depend on a job having
run**. If it fails, is deployed late, or the cluster is down over New Year,
every training log in January either lands in last year's pot or 500s. A
lazy resolve is right by construction: the first log of the new year finds
no 2027 pot and creates one, and a team that logs nothing in January simply
has no 2027 pot yet, which is exactly true.

**The leaderboard query must become season-scoped in the same change.**
Today it selects every `status = 'active'` pot. Under lazy rollover that
would mix teams who have logged in the new year (2027 pot, low points) with
teams who have not (2026 pot, a year of points) into one incoherent table.
This is the part that turns a lazy rollover from simple to correct, and it
is not optional.

## Decision — 2: a scheduled job still exists, but only for presentation

A `@Cron` at the year boundary that:

- flips last year's pots from `active` to `closed`, and
- records which team won.

**Nothing depends on it for correctness** — that is Decision 1's whole
point. If it runs late, the standings are still right; they are just still
labelled "active" for a while. This is the same posture as
`getEffective`'s lazy contact-change apply: the scheduled part is a
convenience, the lazy part is the guarantee.

It reuses the existing `tryClaimScheduledJobRun` Redis lock and the ADR-0022
run-level failure row, like every other job here. One shared
`runScheduledJob` helper is overdue across the five existing ones — noted,
not done here.

## Decision — 3: final standings are computed from closed pots, not snapshotted into a new table

A `TeamSeasonPot` row already holds `teamId`, `seasonId` and `pointsTotal`.
Once closed, nothing writes to it again. The final table for a year is
therefore the existing leaderboard query scoped to that season — same
ranking code, same tie handling, no second source of truth to drift.

Rejected: a `FinalStanding` snapshot table. It would duplicate data that is
already immutable, and the first time the two disagreed, nobody would know
which was right.

**Consequence worth stating**: if a team is deleted (its last player
erases their account, ADR-0013 Decision 5), its pot cascades away and it
vanishes from the historical table too. That is correct — an erased team
should not persist in a public ranking — but it means a past year's
standings can change after the fact, and any UI must not present them as
immutable history.

## Decision — 4: 1 January shows last year's result, not an empty table

The failure mode this design exists to prevent: on 1 January every child
opens the app and sees a leaderboard where every team has 0 points and
their own position is blank. After a year of play, that reads as *the app
lost my progress*.

So the scoreboard leads with the **previous season's final standings**
until the new one is meaningfully underway, then switches. Concretely:

- While fewer than **3 teams** have any points in the current season, the
  board shows last year's final table, clearly labelled as such, with the
  new season noted as just begun.
- Once past that, the live board takes over, with last year's remaining
  reachable as a separate view.

Three is a judgement, not a researched number — it is the smallest count
where a ranking says anything at all. Flagged as an open question.

## Decision — 5: the year ends with a named winner, once, and it is a team moment

VM-Guld is this app's central metaphor. A year that simply rolls over
without anyone being told who won would waste the one moment the whole
mechanic points at.

On first open after the rollover, every player sees a full-screen moment
naming the winning team and their own team's final position — reusing
Screen G2's existing goal-bonus takeover shape rather than inventing a
second celebration idiom. Shown **once per player per season**, tracked the
same way the existing one-shot moments are.

**Deliberately not**: a per-player ranking, a "you were the best player"
award, or anything comparing children to each other. The team is the unit
that competes here, and that is a constraint worth keeping at exactly the
moment it would be most tempting to break.

## Decision — 6: the half-year legacy is closed once, honestly

Every pot that exists today belongs to a "Vår"/"Höst" season, and every one
of them has been accumulating past its own end date — because nothing
enforced it. The first rollover closes them as they are.

**A pot labelled "Vår 2026" will therefore hold points earned after June.**
That label is wrong and cannot be made right retroactively — the training
logs are there, but re-attributing them would be inventing history. The
first closed season should be relabelled **"2026"** at rollover, with the
inaccuracy recorded rather than papered over: it covers everything up to
the reset, whatever its original label said.

## Open questions for the project owner

1. **The 3-team threshold** in Decision 4 — how many teams need points
   before the new season's board replaces last year's?
2. **Does the winner moment name the winning team to everyone**, or only
   tell each team their own position? Naming a winner is the point of a
   championship, but it also broadcasts one team's identity app-wide.
3. **How long does history stay reachable?** Two years, five, forever? It
   is cheap to keep, but "forever" is a promise worth making deliberately
   given the app's retention posture everywhere else.
4. **Is the 2026 relabelling acceptable** (Decision 6), or would you rather
   the first closed season keep its "Vår 2026" label with a footnote?
