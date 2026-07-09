# 0008 - VM-Guld cross-team leaderboard (Fas 2.7)

## Status

Accepted — 2026-07-08

## Context

`docs/ACTION_PLAN.md`'s Fas 2.7: remove the fixed maximum/goal-threshold
framing from the team-pool meter; instead compare a team's point total
against other teams', and tapping the point-pool card opens a leaderboard.
Confirmed product decisions (not re-litigated here):

- A leaderboard row shows **team name + point total only** — never
  player-level data for another team.
- The query must be able to return every team's aggregate **without ever
  joining out to `Player`/`PlayerPrivateInfo`.**

This is the first feature in the app that shows anything across a team
boundary at all — every prior Phase 1-2 surface is scoped to "your own
verified team," full stop (CLAUDE.md's closed-team-bubble constraint). This
ADR is explicit about why a coarse, non-personal aggregate (a team's name
and a number) crossing that boundary is consistent with the constraint, not
an exception to it: "closed team bubbles" protects a child's data — video,
comments, consent status, screen names in others' feeds — from leaking
outside their own verified team. It has never meant a team's mere existence
and season score are secret from other teams, any more than a real sports
league hides other clubs' standings. As long as no `Player`-level data ever
crosses (the product decision's own hard requirement, and this ADR's
central design constraint), this feature doesn't weaken the constraint —
it's the first place the constraint gets tested against a genuine
cross-team query, which is exactly why the "never join to Player" rule is
stated as a structural requirement below, not a code-review reminder.

## Decision — 1: the query — Postgres only, no new Redis structure

```sql
SELECT team.id, team.name, team_season_pot.points_total
FROM team_season_pot
JOIN team ON team.id = team_season_pot.team_id
WHERE team_season_pot.status = 'active'
ORDER BY team_season_pot.points_total DESC;
```

This is the entire query. It touches exactly two tables — `team_season_pot`
and `team` — and **structurally cannot** return anything from `Player` or
`PlayerPrivateInfo`, because neither is joined. This is the concrete answer
to the product decision's "must be able to return every team's aggregate
without ever joining out to Player/PlayerPrivateInfo data": there is no
`player_id` anywhere in this query for a future contributor to
accidentally extend into a per-player breakdown — the boundary is
structural (which tables the query names), the same reasoning ADR-0002
already used for why `Player`'s own table can't leak `real_name`
(`PlayerPrivateInfoModule` is a separate module `PlayersService` never
imports).

A team with no currently-`active` `TeamSeasonPot` (between seasons, or
never seeded one) is simply **absent from the leaderboard**, not shown at
zero or erroring the whole query — different from
`TeamPoolService.getActivePotForTeam`'s existing behavior (which throws a
`500` when *the requesting team itself* lacks an active pot, since that's
treated as an operational setup bug worth surfacing loudly for that team's
own dashboard). A system-wide leaderboard has a different failure posture:
one other team's setup gap shouldn't break visibility into everyone else,
so the query just filters, it doesn't validate.

### Why no Redis sorted set, unlike ADR-0002's existing leaderboard pattern

ADR-0002 already establishes Redis sorted sets as this app's leaderboard
pattern ("per-team individual streak leaderboard, keyed by team"). This
feature deliberately doesn't extend that pattern yet: a plain Postgres
join-and-sort across a "handful" of teams (this project's own repeated
capacity assumption, e.g. the weekly-goal history endpoint's "no
pagination... a team has a handful of these") is not a real performance
problem, and CLAUDE.md is explicit that this is a pre-MVP project that
shouldn't design for scale it doesn't have. Building a new Redis structure
(a global sorted set, an invalidation/update path on every
`TeamPoolService.addPoints` call, a rebuild-on-flush script alongside the
existing `rebuild-redis-cache.ts`) for a query this cheap at this team
count is the "impressive but unnecessary" option this ADR explicitly
avoids. If team count or leaderboard polling frequency ever makes this
measurable, the existing Postgres-then-Redis pattern is the obvious next
step — flagged for later, not built now.

## Decision — 2: season-basis fairness is an accepted, explicitly-flagged limitation, not a blocker

`team-pool/entities/season.entity.ts`'s existing comment already flags
season rollover as an open gap: `Season`/`TeamSeasonPot` creation is still
seed/admin-only, per-team, with no enforced relationship between different
teams' season date ranges. A cross-team leaderboard compares raw
`points_total` values, which is only an apples-to-apples comparison if
every team's active season covers roughly the same period — nothing in the
schema guarantees that.

**Decision: accept this as a known limitation for the current phase,
explicitly, rather than blocking the leaderboard on solving season
rollover.** Reasoning:

- Season/pot creation is still a manual, infrequent, seed/admin action
  (unchanged by this ADR) — in practice, every team in the current beta was
  set up around the same time, by the same process, so the "different
  start dates" failure mode this decision accepts is not yet observed, only
  theoretically possible.
- Solving it properly (e.g. normalizing by elapsed-season-fraction, or
  requiring all teams share one season) is real, non-trivial design work
  that ACTION_PLAN's Fas 2.7 wording doesn't ask for and that would block a
  "small phase" (its own description) on a problem it doesn't yet have.
- **Concrete trigger for revisiting, stated so this isn't an indefinite
  deferral**: the first time a real self-serve season-rollover flow exists
  (letting a team start a new season independent of others' schedules,
  rather than everyone being seeded together), or the first time a coach/
  captain reports the comparison as unfair in practice, this gap needs a
  real design pass — not before.

This is a deliberate call, not an oversight: the task instructions asked
this ADR to decide whether the gap blocks a fair leaderboard now or is
acceptable — the decision is **acceptable for now, flagged plainly, with a
stated condition for when that stops being true.**

## Decision — 3: endpoint contract and rank computation

**`GET /api/v1/teams/:teamId/leaderboard`** — player auth,
`assertTeamMembership` only (every other Phase 2 team-scoped `GET` is open
to any teammate, not captain-gated; nothing here is more sensitive than the
dashboard's existing `teamPool` block).

Returns the requesting team's own rank plus the full sorted list — one
call, no second round-trip, matching this project's established "no extra
round-trip" principle. **Standard competition ranking** (ties share the
lower rank number; the next distinct score skips accordingly, e.g. two
teams tied at 1800 points both rank `2`, the next team ranks `4`) — the
same tie-handling `RANK()` would produce, computed once for the whole list
so every row and the `requestingTeam` block agree by construction rather
than being derived two different ways.

If the requesting team itself currently has no active pot, the leaderboard
still returns (every *other* team's rows), with `requestingTeam: null` —
deliberately more graceful than the dashboard's `500`-on-missing-pot
behavior, since "show me everyone" shouldn't fail just because the caller's
own team is between seasons.

See `docs/api/phase2.7-contract.md` for the exact response shape, and for
the **home-card rank** addition to the existing dashboard/`GET /players/me`
`teamPool` blocks (a cheap `COUNT(*) WHERE points_total > mine` query,
computed on those already-infrequent reads — deliberately **not** added to
`POST /training-logs`'s response, to keep the app's hottest write path free
of a new cross-team aggregate query on every single training log; a
just-logged player sees their updated rank on their next dashboard/`me`
fetch, not synchronously in the log response).

## Decision — 4: removing `goalThreshold`/`percentComplete` is a breaking contract change — flagged explicitly

The product decision ("no maximum/goal-threshold framing anymore") is a
real removal, not a UI reinterpretation of the same data: `goalThreshold`
and the percent-toward-it framing stop being meaningful once there's no
threshold to be a percentage of. This **breaks** three existing response
shapes verbatim:

- `GET /api/v1/players/me`'s `teamPool` block (`docs/api/phase1-contract.md`)
- `GET /api/v1/teams/:teamId/dashboard`'s `teamPool` block
  (`docs/api/phase2-contract.md`)
- `POST /api/v1/training-logs`'s `teamPool` response block (both contracts)

All three currently return `goalThreshold`/`percentComplete`; all three
**drop both fields** under this ADR, per `docs/api/phase2.7-contract.md`'s
exact replacement shapes. This is called out explicitly, not left for
frontend-developer to discover at runtime, because it's a genuine breaking
change to already-implemented, already-shipped response shapes (Phase 1 and
2 are both functionally complete and in beta with real users per
`docs/ACTION_PLAN.md`) — frontend-developer needs to update every call site
that currently renders a "percent to goal" bar/number for the top-level
meter, not just add a new leaderboard screen.

### Schema: `TeamSeasonPot.goal_threshold` stays in the database, dormant

**Decision: do not drop the column.** Leave `goal_threshold` in place,
`NOT NULL`, unused by any response or computation — the same posture this
codebase already takes with `Coach`/`TeamCoach` (ADR-0004's addendum: "kept
only because the schema already exists... deleting working schema to
reintroduce it later would be exactly the kind of churn this project's ADRs
otherwise avoid") and `TrainingLogEntry.challenge_id` (ADR-0005: "stays in
the schema, untouched, exactly as dormant as it already was"). Dropping the
column would be a data-loss migration for a product decision that's about
*what the API surfaces*, not *what the database can represent*; keeping it
costs nothing (no query anywhere selects it once the response-shape changes
above ship) and avoids a migration that isn't buying anything. If a future
feature wants a per-season target again, the column and its existing seed
data are still there.

### What replaces it

Nothing, at the field level — the top-level meter's job becomes "show
`pointsTotal` and how it compares," which is exactly what Decision 3's new
`rank`/`teamCount` fields (on dashboard/`me`) and the leaderboard endpoint
itself already provide. There is no like-for-like replacement for
"percent complete," because "complete toward what" no longer has an answer
— that absence is the point of the product decision, not a gap in this
ADR.

## Consequences

- Breaking change to three existing response shapes (Decision 4) — flagged
  above and in `docs/api/phase2.7-contract.md` in enough detail for
  frontend-developer to update every affected screen, not just build the
  new leaderboard view.
- One new endpoint (`GET /teams/:teamId/leaderboard`), two new fields
  (`rank`, `teamCount`) added to the existing dashboard and `GET
  /players/me` `teamPool` blocks, no new fields on `POST /training-logs`
  (deliberately, per Decision 3's hot-path reasoning).
- No schema migration required beyond what already exists — `team.name`
  and `team_season_pot.points_total` are both already real columns; this
  ADR only changes which queries read them and in what combination.
  `goal_threshold` stays, unused, per Decision 4.
- No new Redis structure (Decision 1) — revisit only if team count or
  polling frequency later makes the plain Postgres query measurable.
- The season-basis fairness gap (Decision 2) is accepted, not solved, with
  a stated condition for revisiting it — flagged for security-reviewer and
  the project owner to confirm they agree this is acceptable for the
  current beta scale, not silently assumed.
- **Not decided here, flagged explicitly for ux-designer**: the button/card
  copy "Lagets VM-Guld-pott" needs a new name now that it opens a
  leaderboard rather than showing progress toward a fixed goal — the
  project owner raised this and explicitly deferred the actual wording,
  per `docs/ACTION_PLAN.md`. This ADR does not pick one; it's a UX/copy
  decision for ux-designer's flow-design pass, not an architecture one.
- `Team.name` (already-existing, coach-chosen at team creation) becomes
  cross-team-visible for the first time via the leaderboard. This is not a
  new field or new sensitivity level — it already existed, coach-chosen,
  since Phase 1 — but it is the first time it's shown to players outside
  that team, worth a quick security-reviewer sanity check (e.g. that no
  team has ever been seeded with a name that itself encodes something
  sensitive) rather than a design change here.
