# 0016 - Cross-team VM-Guld leaderboard fairness (roster-size normalization)

## Status

Proposed — 2026-07-31.

## Context

`docs/BACKLOG.md`'s "Cross-team score fairness — a 3-4 person team can't
compete fairly against a 15 person team" entry, raised by the project owner
2026-07-30, verbatim complaint: `docs/adr/0008-vm-guld-cross-team-leaderboard.md`'s
leaderboard ranks teams on raw `TeamSeasonPot.pointsTotal` — a 15-person
team structurally out-accumulates a 3-4 person team by having more people
logging sessions, independent of any individual's actual effort.

This is the same class of change as ADR-0005 Decision 3's 2026-07-05
bonus-formula correction and ADR-0015's just-shipped per-player-completion
correction — a correction to an already-shipped, already-reviewed
ranking/points formula, not a new feature — and gets the same rigor: read
in full against `docs/adr/0008`, `team-pool.service.ts` (the actual
leaderboard query and rank computation), `docs/api/phase2.7-contract.md`,
and ADR-0015's eligible-roster precedent before drafting this.

The backlog entry already names the central tension and three candidate
directions, none chosen: (a) a minimum-team-size floor before a team
qualifies for the board at all, (b) statistical shrinkage/regularization on
small samples, (c) rank/percentile normalization instead of a raw average.
It also flags, correctly, that a naive per-player average just trades one
unfairness (big teams always win) for two others (small-team volatility,
small-team gameability). Each option is evaluated below, not just listed.

Two things confirmed by reading the current implementation, not assumed:

- **No minimum-roster-size concept exists anywhere in this codebase today**
  (checked team creation, `docs/adr/0009-self-service-team-creation.md`,
  `TeamsService`) — a team of 1 is currently a fully valid, fully-functional
  team. Any floor this ADR might introduce is new, not tightening something
  half-built already.
- ADR-0008 Decision 1's leaderboard query is **structurally two tables only**
  (`team_season_pot` JOIN `team`), stated as a hard requirement so no future
  contributor could accidentally leak player-level data cross-team. This ADR
  has to touch that boundary (a per-team roster **count** is required for
  any of the three candidate fixes) and addresses head-on, in Decision 2,
  why a count-only join preserves the actual privacy principle even though
  it changes the letter of "never joined."

## Decision 1 — additive second ranking view, not a replacement of `pointsTotal`

**The existing raw-total leaderboard (`GET /teams/:teamId/leaderboard`,
`requestingTeam`/`leaderboard`, the dashboard/`me` `rank`/`teamCount`
fields) is unchanged, byte-for-byte.** This ADR adds a second,
fairness-adjusted ranking (`effortLeaderboard`/`requestingTeamEffort`) to
the *same* response, computed alongside it — not a schema/meaning change to
`pointsTotal`, `rank`, or any field an already-shipped client already
renders.

Why additive, not a replacement, weighed directly:

- **A big total is real and teams take pride in it** — the backlog task
  itself raises this, and it's correct: a 15-person team's 3000 points
  represents 15 real kids' worth of real training, and hiding that number
  because *some other* team is small would be its own unfairness in the
  other direction. "Most points" and "best effort per player" are both
  true, useful, non-contradictory facts about a team — this app can show
  both instead of picking a winner between them.
- **A breaking replacement would force the same coordinated-deploy cost
  ADR-0005/ADR-0015 both had to pay** (mobile and backend shipping the new
  meaning together, every existing call site re-audited) **for a fix that
  doesn't need it.** Nothing about "add a second, independently-computed
  ranking" requires changing what `pointsTotal`/`rank` mean to any existing
  caller. Additive is the boring option that actually is boring here, not
  just the safer-sounding one.
- A tab-based UI ("Mest poäng" vs. "Bästa laginsats", exact copy deferred to
  ux-designer per the same posture ADR-0008 Decision 4's copy note already
  took) reads naturally off "two views of the same response," which is also
  why this is one endpoint response gaining fields, not a second endpoint —
  see Decision 4.

## Decision 2 — the fairness metric: shrinkage-adjusted points-per-eligible-player, not a floor or plain rank/percentile

### The three named options, evaluated

**(a) Minimum-team-size floor** (exclude teams below N eligible players from
the board entirely). Rejected as the primary mechanism: it's a hard cliff
that doesn't fix anything for teams *above* the floor (a 6-person team still
loses to a 15-person team on raw total even if both clear N=4), and it
actively excludes the exact team the backlog complaint is about — a
3-4-person team doesn't get "fairness," it gets removed from the board
altogether, which is a worse outcome for that team than today's unfair-but-
visible ranking. A floor solves "protect against a 1-person team dominating
by fluke," which shrinkage (below) already solves without excluding anyone.

**(b) Statistical shrinkage/regularization.** A small team's per-player
average is pulled toward the cross-team mean in proportion to how small its
sample is — the same "weighted rating" mechanism IMDB/similar ranked-review
systems use for exactly this problem (a 5-star average from 3 reviews
shouldn't outrank a 4.8-star average from 3,000). This directly answers
both risks the backlog flags for a naive average: **volatility** (one
freak day's swing on a tiny roster gets damped, not amplified, because the
formula weights the team's own average less the smaller its sample is,
pulling it toward the stable league-wide mean instead) and, partially,
**gameability** (a short coordinated burst on a 2-3 person team is pulled
hard toward the mean — see the worked example below — rather than
translating directly into a top rank). **This is the decision.**

**(c) Rank/percentile normalization instead of a raw average.** Rejected as
the *primary* mechanism, though a form of it is still used downstream (see
Decision 3): ranking by percentile alone discards magnitude entirely (a
team narrowly ahead of the median and a team miles ahead both just have "a
better percentile"), which is harder to explain to a kid than "your team's
adjusted score is X" and, more importantly, **doesn't address the stated
problem on its own** — it re-orders the same noisy small-team averages, it
doesn't reduce their noise. Percentile normalization is a display technique
for an already-computed score, not a fix for the score itself.

### The formula

For every team with a currently-`active` `TeamSeasonPot` and at least one
**eligible player** (reusing ADR-0015 Decision 2's exact eligibility
definition — `parentalConsentStatus = 'approved' AND teamJoinStatus =
'approved'` — the same "can this player actually have logged training"
gate already established and reviewed for the weekly goal):

```
n              = team's eligible player count
teamAverage    = pointsTotal / n
C (league mean)= SUM(pointsTotal across all qualifying teams)
                 / SUM(eligiblePlayerCount across all qualifying teams)
k (shrinkage)  = GREATEST(3, median(eligiblePlayerCount across all qualifying teams))

adjustedScore  = (n / (n + k)) * teamAverage  +  (k / (n + k)) * C
```

- **`C` is the league-wide pooled average** (total points ÷ total eligible
  players across every qualifying team), not a mean-of-team-averages — the
  standard choice for this formula's prior, and it weights each team's
  contribution to the "typical" rate by its actual player-count exposure
  rather than letting a tiny team's average count as much as a big team's
  when computing what "typical" even means.
- **`k` is computed live, from this app's own current data, not a hardcoded
  constant.** The median (not mean, so one outlier large roster can't skew
  it) eligible-player-count across all currently-qualifying teams, floored
  at 3 so `k` doesn't collapse to something like 1 while the beta only has
  a handful of teams seeded. This is the same reasoning ADR-0008 Decision 1
  already used for *not* building a Redis structure ("the boring option
  that fits this project's actual current scale") applied to constant-
  tuning: deriving `k` from the league's own current roster sizes means
  this formula self-calibrates as real team sizes emerge post-beta, instead
  of needing a manually-tuned magic number revisited every few months.
- A team with `n = 0` (every player still consent-pending, or a
  self-created team with no approved joiner yet) is **excluded from this
  view entirely**, same "absent, not shown at zero" posture ADR-0008
  Decision 1 already established for a missing pot — there's no meaningful
  average to shrink.

### Worked example (four teams, matching the backlog's own 3-4-vs-15 framing)

| Team | n (eligible) | pointsTotal | raw rank | teamAverage |
|------|------|-------------|----------|-------------|
| A    | 15   | 3000        | 1        | 200.0       |
| C    | 10   | 1800        | 2        | 180.0       |
| B    | 4    | 1200        | 3        | 300.0       |
| D    | 6    | 900         | 4        | 150.0       |

`C (league mean) = (3000+1800+1200+900) / (15+10+4+6) = 6900/35 ≈ 197.1`
`k = GREATEST(3, median(15,10,4,6)=8) = 8`

| Team | weight on own average `n/(n+k)` | adjustedScore | effort rank |
|------|------|----------------|------|
| B    | 4/12 = 0.33  | 0.33×300 + 0.67×197.1 ≈ **231.5** | **1** |
| A    | 15/23 = 0.65 | 0.65×200 + 0.35×197.1 ≈ **199.0** | 2 |
| C    | 10/18 = 0.56 | 0.56×180 + 0.44×197.1 ≈ **187.5** | 3 |
| D    | 6/14 = 0.43  | 0.43×150 + 0.57×197.1 ≈ **176.9** | 4 |

Team B (4 players, the smallest, the highest raw per-player rate) moves
from last-by-raw-total to first-by-effort. Team A (15 players) drops from
first to second on the effort view but is barely dented — its large `n`
means the formula trusts its own average almost fully, exactly the intended
behavior (a big team's real per-player performance isn't punished, only a
small team's noise is damped). Note this is illustrative math for the ADR,
not something backend-developer needs to hand-verify against — the exact
SQL/aggregation is Decision 3.

### What this doesn't solve, stated plainly rather than implied

- **This is a roster-size fix, not a training-authenticity fix.**
  `docs/BACKLOG.md`'s separate points-verification-tier item (unverified
  self-report vs. photo/video-verified) is the mechanism that would make a
  "short coordinated burst" harder to fake in the first place; this ADR
  only makes a burst's effect on *rank* less decisive by pulling small
  samples toward the mean. The two items are complementary, not
  substitutes — not conflated further here.
- **No mid-season-joiner exclusion, unlike ADR-0015's per-player weekly
  goal.** VM-Guld seasons are ~6 months (the half-year calendar grid,
  `half-year-season.util.ts`), not a 1-week goal window — a player joining
  in month 5 still has meaningful time to contribute, so excluding
  late-joiners the way ADR-0015 had to (a genuine 1-week fairness necessity
  there) would be over-engineering a problem this feature doesn't actually
  have at this timescale. Flagged as a considered-and-declined option, not
  an oversight.
- **This does not solve ADR-0008 Decision 2's already-accepted season-basis
  gap** (different teams' active seasons aren't guaranteed to cover the
  same period) — `adjustedScore` inherits that same limitation exactly as
  `pointsTotal` already does, unchanged by this ADR, still governed by that
  decision's own stated revisit trigger.

## Decision 3 — rank computed via standard competition ranking on `adjustedScore`, same tie-handling as today

`TeamPoolService.computeStandardCompetitionRanks` already implements
"ties share the lower rank, next distinct score skips" for `pointsTotal`.
This ADR generalizes it (or adds a sibling method with the same logic — an
implementation-detail choice for backend-developer, not fixed here) to rank
by `adjustedScore` for the effort view, computed once server-side so the
`effortLeaderboard` array and `requestingTeamEffort.rank` agree by
construction, exactly the reasoning ADR-0008 Decision 3 already gives for
why rank is never independently re-derived per row.

## Decision 4 — query shape: one additional aggregate query, a count-only join to `Player`

**New method on `TeamPoolService`, alongside the existing
`queryActivePotsWithTeamNames`:**

```sql
SELECT
  team.id AS "teamId",
  team.name AS "teamName",
  pot.points_total AS "pointsTotal",
  COUNT(player.id) FILTER (
    WHERE player.parental_consent_status = 'approved'
      AND player.team_join_status = 'approved'
  ) AS "eligiblePlayerCount"
FROM team_season_pot pot
JOIN team ON team.id = pot.team_id
LEFT JOIN player ON player.team_id = team.id
WHERE pot.status = 'active'
GROUP BY team.id, team.name, pot.points_total
```

`C` and `k` (league mean, shrinkage constant) are then computed in
application code from this same result set — no second query.
`adjustedScore`/rank computation happens in TypeScript, mirroring how
`computeStandardCompetitionRanks` is already a plain static method over an
already-fetched array rather than a second round-trip to Postgres.

### Why this doesn't weaken ADR-0008's "never join to Player" rule, addressed explicitly

ADR-0008 Decision 1 states the leaderboard query "structurally cannot
return anything from `Player`... because neither is joined," and frames
that as the concrete answer to the product requirement "no player-level
data ever crosses a team boundary." **This ADR adds a join to `Player`, but
selects nothing from it except a `COUNT`** — no `screenName`, no
`consentStatus`, no `playerId`, nothing that identifies or describes any
individual child. This is the same reasoning ADR-0008 itself already uses
to justify exposing `Team.name`/`pointsTotal` cross-team in the first
place ("a coarse, non-personal aggregate... crossing that boundary is
consistent with the constraint, not an exception to it"), and the same
reasoning ADR-0015 Decision 4 uses *within* a team for exactly this
count-vs-detail distinction (`approvedCount`/`pendingCount` visible to any
teammate; *which* specific player is pending is captain-gated). A roster
size is closer in kind to "this team has 12 players" than to any
consent-adjacent or identity-adjacent fact — it's operational team
metadata, not a fact about any specific child.

**Still flagged for security-reviewer sign-off before this ships**, the
same posture ADR-0008's own Consequences section already took for exposing
`Team.name` cross-team for the first time — not because this ADR judges it
risky, but because "first time a cross-team query joins to `Player` at
all," even count-only, is exactly the kind of boundary-precedent worth an
independent second look rather than architect self-certifying it.

## Decision 5 — response contract: additive fields only

```ts
// GET /api/v1/teams/:teamId/leaderboard — existing fields unchanged.
{
  requestingTeam: { teamId, teamName, pointsTotal, rank } | null;  // UNCHANGED
  leaderboard: Array<{ rank, teamId, teamName, pointsTotal, isRequestingTeam }>; // UNCHANGED

  // NEW, additive:
  requestingTeamEffort: {
    teamId: string;
    teamName: string;
    eligiblePlayerCount: number;   // EXACT — own team only, never crosses a team boundary
    pointsPerPlayer: number;   // raw teamAverage, one decimal — the honest, unadjusted number
    adjustedScore: number;     // the shrinkage-adjusted number rank is computed from, one decimal
    rank: number;
  } | null;   // null if the requesting team has eligiblePlayerCount === 0, same posture as requestingTeam's own null case
  effortLeaderboard: Array<{
    rank: number;
    teamId: string;
    teamName: string;
    eligiblePlayerCountRange: '1-2' | '3-5' | '6+';   // BUCKETED, not exact — see "Cross-team eligiblePlayerCount exposure" below (2026-07-31 revision)
    pointsPerPlayer: number;
    adjustedScore: number;
    isRequestingTeam: boolean;
  }>;   // teams with eligiblePlayerCount === 0 simply absent, same as a missing pot today
}
```

One endpoint, both views, no second round-trip — the same "no extra
round-trip" principle ADR-0005/ADR-0008 both already establish for this
codebase. `docs/api/phase2.7-contract.md` is updated by backend-developer
to match, per this project's usual division (architect specifies the shape
here; the contract doc is the implementer's living copy of it, same
pattern ADR-0015's Consequences section already used).

**Dashboard/`me` home-card fields**: add `effortRank`/`eligiblePlayerCount`
alongside the existing `rank`/`teamCount` in the `teamPool` block, computed
on the same already-infrequent dashboard/`me` reads — deliberately **not**
added to `POST /training-logs`'s response, for the identical hot-path
reason ADR-0008 Decision 3 already gives for keeping `rank`/`teamCount` off
that endpoint's response. This is the requesting player's own team, read
from their own dashboard — never another team's row — so it is unaffected
by the revision below and stays an exact integer.

### Addendum (2026-07-31) — cross-team `eligiblePlayerCount` exposure: small-team consent-status leak (security-reviewer finding, blocking)

**Finding.** Before ship, security-reviewer confirmed that `eligiblePlayerCount`
on `effortLeaderboard`'s per-row shape (this Decision, as originally
written above) exposes an exact integer for every *other* team, not just
the requesting team's own row. This codebase has no minimum-roster-size
concept (confirmed in Context above) — a team of 1 is fully valid — so for
such a team `eligiblePlayerCount` is mechanically either `0` or `1`, and
by construction (`parentalConsentStatus = 'approved' AND teamJoinStatus =
'approved'`, Decision 2) that single bit **is** one specific, identifiable
child's parental-consent-and-join-approval status, not an aggregate over
multiple children. Combined with Decision 2's "n = 0 teams are absent from
`effortLeaderboard` entirely," any player on any other team could poll
this endpoint and watch a small team's row appear — `eligiblePlayerCount`
going from (absent) to `1` — and learn the exact moment a specific,
named-via-cross-team-visible-`teamName` child's parent approved consent or
a captain approved their join. That is exactly the class of leak ADR-0008's
"player data never crosses a team boundary" rule and CLAUDE.md's
non-negotiable parental-approval constraint exist to prevent, and Decision
4's own defense of this join ("closer in kind to 'this team has 12
players' than to any consent-adjacent fact") does not hold once `n` is
small enough to *be* a consent-adjacent fact rather than describe one.

Not affected, unchanged: `adjustedScore`/`pointsPerPlayer` on cross-team
rows (blended with the league-mean prior, never a raw approval count),
`teamName` cross-team exposure (parity with the already-accepted raw
leaderboard per ADR-0008), and `eligiblePlayerCount` on the requesting
team's *own* `requestingTeamEffort`/dashboard fields (never crosses a team
boundary in the first place — the player already sees their own roster
elsewhere, e.g. the teammates list).

**Decision: bucket the cross-team-visible count into three ranges — `'1-2'`
/ `'3-5'` / `'6+'` — rather than a display floor or dropping the field.**

Three options were weighed against this ADR's own stated goal for showing
the count at all (Decision 2's fairness legibility, and the ux-designer
mockup's item 18: making "how did a small team out-rank a big one"
self-evident at a glance):

- **Suppress the row below a floor (e.g. n < 4)** — rejected. This is the
  display-layer version of the exact "(a) minimum-team-size floor" option
  Decision 2 already rejected as a *ranking* mechanism, for the same
  reason restated at the display layer: it doesn't fix anything for the
  team the floor excludes, it just hides it — and the teams a floor would
  hide are disproportionately the small teams this whole feature exists to
  showcase (Team B in Decision 2's own worked example, n=4, is the effort
  #1; a genuine 3-person effort winner would be *invisible in its own
  victory* under a floor). It also reintroduces gaps in a rank sequence
  that this screen's existing tie-handling convention has already trained
  players to read as "ties, not bugs" — an unexplained missing rank number
  would read as broken, the opposite of the legibility goal. Worse on both
  privacy-adjacent UX and product grounds than either remaining option, so
  rejected outright rather than adopted as a supplement.
- **Drop `eligiblePlayerCount` from cross-team rows entirely** — closes the
  finding completely and is the simplest change, but has a real,
  acknowledged cost: it's the field the ux-designer's mockup (per the
  addendum in `docs/design/phase2.6-2.7-flows.md`, design-decision #18)
  explicitly built the row layout around, specifically *because* it's "the
  one number that makes it self-evident at a glance, not a mystery
  requiring the explainer sheet." Removing it turns every small-team win
  back into exactly that mystery for anyone who doesn't tap through to the
  LB3 explainer sheet — a genuine regression against Decision 2's own
  "answer the backlog's fairness complaint legibly" goal, not a
  cost-free simplification.
- **Bucket the count into coarse ranges — chosen.** Fully closes the
  finding: `'1-2'` can never be reported as the single value `'1'`, so the
  exact 0→1 transition the finding names is never observable through this
  field — the most a poller ever learns is "somewhere in this range,"
  and (confirmed by re-checking the rest of this contract and the wider
  codebase) no other cross-team-visible field exposes another team's
  *total* roster size, so there is no way to combine this with another
  signal to disambiguate a bucket down to a single child. It preserves
  the row's self-evidence purpose close to fully intact — "1-2 spelare"
  answers "why did this tiny team out-rank a big one" exactly as well as
  "1 spelare" did for a 9-year-old glancing at the row; the mockup's own
  stated reason for showing the field at all (legibility, not precision)
  survives the bucketing.

**Residual, stated plainly rather than implied:** bucketing narrows the
exact-value leak to a 2-value range, it does not theoretically eliminate
every possible inference (e.g. a player who already knows, from some
channel entirely outside this app, that a specific other team's *total*
roster is exactly 1 could still infer `'1-2'` means `1`). This is accepted
as a residual on the same grounds ADR-0008 already accepted `teamName`'s
own cross-team exposure: the threat model this contract defends against is
routine, in-app, algorithmic observation of this app's own data (a player
polling the endpoint), not a determined actor combining this with
material this app never provided. If a future feature ever exposes
another team's total roster size cross-team, this residual must be
re-examined at that time — flagged here so it isn't rediscovered cold.

**Exact behavior:**

- New helper, `TeamPoolService.bucketEligiblePlayerCount(n: number):
  '1-2' | '3-5' | '6+'` — pure, static, colocated with the existing
  `round1`/`median` helpers. `n <= 2 → '1-2'`, `n <= 5 → '3-5'`, else
  `'6+'`. Never called with `n === 0` (Decision 2's existing "absent, not
  shown at zero" already excludes those rows before this helper is
  reached).
- **The bucketing is a response-serialization concern only — it changes
  nothing about Decisions 2/3's math.** `TeamPoolService`'s internal
  `EffortLeaderboardRow`, `getEffortLeaderboard()`,
  `computeEffortLeaderboard()`, and `getEffortRankAndEligibleCountOrThrow()`
  all keep returning/consuming the **exact** integer, unchanged — `C`, `k`,
  `adjustedScore`, and rank are computed exactly as before. The bucket
  function is applied exactly once, at the point `weekly-goal.service.ts`'s
  `getLeaderboard()` builds the **cross-team** `effortLeaderboard` array
  for the HTTP response; `requestingTeamEffort` continues to read the
  exact `eligiblePlayerCount` off the same already-fetched row, unchanged.
- `EffortLeaderboardEntry.eligiblePlayerCount: number` (weekly-goal.service.ts)
  is renamed to `eligiblePlayerCountRange: '1-2' | '3-5' | '6+'` — a
  rename, not just a type change, so the field name itself signals "this
  is a bucket, not a count" and a future contributor can't accidentally
  treat it as a number (e.g. sort or sum it). `requestingTeamEffort` and
  the dashboard/`me` `eligiblePlayerCount` field are untouched.
- This is a pre-ship contract change (the finding blocked ship; nothing
  described in this ADR has shipped to a real client yet), so this is a
  correction to an unreleased shape, not a breaking change requiring the
  coordinated-deploy handling ADR-0005/ADR-0015 needed for already-shipped
  fields — consistent with Decision 1/5's "additive, no coordinated
  deploy" framing, which still holds for every *other* field in this
  contract.

**ux-designer follow-up needed, not resolved here:** `docs/design/phase2.6-2.7-flows.md`'s
effort-tab row copy (around line 826, "IBK Falken P13 · 4 spelare") and
design-decision #18 currently assume an exact `eligiblePlayerCount`. Both
need a small copy update to read off `eligiblePlayerCountRange` instead
(e.g. "IBK Falken P13 · 1-2 spelare" / "3-5 spelare" / "6+ spelare",
exact Swedish phrasing and any range-formatting convention, e.g. en-dash
vs hyphen, left to ux-designer, same deferred-copy posture this ADR has
used throughout). LB3's own-team transparency line already reads off
`requestingTeamEffort.eligiblePlayerCount`, which is exact and unaffected,
so no change needed there.

## Consequences

- No schema migration — `adjustedScore`/`eligiblePlayerCount`/`k`/`C` are
  all computed live from existing columns (`team_season_pot.points_total`,
  `player.parental_consent_status`, `player.team_join_status`), the same
  "boring, no migration" posture ADR-0008 already took for its own feature.
- No new Redis structure — same reasoning as ADR-0008 Decision 1 (a plain
  Postgres aggregate over "a handful of teams" is not a real performance
  problem at this project's actual scale); revisit only under the same
  trigger ADR-0008 already names.
- **Purely additive contract change** — unlike ADR-0005/ADR-0015, this
  requires no coordinated same-window frontend/backend deploy, since no
  existing field's meaning changes. Frontend-developer can ship the new
  effort-view tab on its own schedule once backend-developer's fields exist.
- One new count-only join from the leaderboard query path to `Player` —
  flagged explicitly (Decision 4) as a considered, bounded exception to
  ADR-0008's "never joined" implementation detail, with the underlying
  privacy principle (no player-level data crosses a team boundary)
  unchanged and, argued above, still fully intact. **Security-reviewer
  sign-off required before ship**, same posture as ADR-0008's own
  cross-team `Team.name` exposure got — Decision 4's count-only-join
  reasoning itself still stands as originally argued; the 2026-07-31
  addendum above is the fix for the *separate*, since-confirmed finding
  about how that count was exposed cross-team (small-`n` teams'
  `eligiblePlayerCount`), not a retraction of Decision 4.
- Two accepted, explicitly-flagged limitations carried into the new view
  (Decision 2's "what this doesn't solve"): no training-authenticity
  guarantee (a separate backlog item), and no mid-season-joiner exclusion
  (a considered-and-declined option at this feature's ~6-month timescale).
- **A third, now-closed limitation** (2026-07-31 addendum): cross-team
  `eligiblePlayerCount` on `effortLeaderboard` rows degenerated to a
  single named child's consent/join-approval status on small-`n` teams —
  closed by bucketing that field to `eligiblePlayerCountRange` (`'1-2'` /
  `'3-5'` / `'6+'`) on cross-team rows only; `requestingTeamEffort` and the
  dashboard's own-team `eligiblePlayerCount` remain exact, unaffected.
- **Follow-up work, not designed here**: ux-designer names and designs the
  tab/toggle between "Mest poäng" and "Bästa laginsats" (or equivalent
  Swedish copy — not fixed here, same deferred-copy posture as ADR-0008
  Decision 4) on the leaderboard screen and the dashboard home-card's new
  `effortRank`, **and updates the effort-tab row copy to read off the new
  `eligiblePlayerCountRange` bucket instead of an exact count** (2026-07-31
  addendum); backend-developer implements Decisions 2-5 against
  `team-pool.service.ts`/`weekly-goal.service.ts` (including the
  2026-07-31 bucketing addendum) and updates
  `docs/api/phase2.7-contract.md`; security-reviewer confirms Decision 4's
  count-only-join reasoning **and** the 2026-07-31 bucketing fix before
  ship.
