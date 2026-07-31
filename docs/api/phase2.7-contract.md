# Phase 2.7 API Contract — VM-Guld cross-team leaderboard

## Status

Draft for Fas 2.7 build — architect-owned, for backend-developer/
frontend-developer to build against. See
[`docs/adr/0008-vm-guld-cross-team-leaderboard.md`](../adr/0008-vm-guld-cross-team-leaderboard.md)
first — this doc assumes its schema/decisions.

**This is a breaking change to three already-shipped response shapes** —
`GET /players/me` (`phase1-contract.md`), `GET /teams/:teamId/dashboard`
(`phase2-contract.md`), and `POST /training-logs` (both). Read "Breaking
changes" below before touching any existing screen that renders the
team-pool meter.

**Updated 2026-07-31 — additive fairness fields (ADR-0016).** See
["1a. The effort view (additive, ADR-0016)"](#1a-the-effort-view-additive-adr-0016)
below. Unlike the rest of this doc, this addition is **not** a breaking
change and needs no coordinated frontend/backend deploy — it only adds
fields alongside the ones this doc already specifies.

## Conventions

Unchanged from `phase2-contract.md`: base path `/api/v1`, one auth
universe, `team_mismatch` check on every team-scoped endpoint, standard
error envelope. No captain gate on anything below — a team's own
standing/rank is not sensitive relative to its own players, and the
leaderboard shows no player-level data at all for *other* teams (the
product's hard constraint — see the ADR).

---

## Endpoints

### 1. `GET /api/v1/teams/:teamId/leaderboard`

Player auth + `team_mismatch` check only.

Response `200`:
```json
{
  "requestingTeam": {
    "teamId": "uuid",
    "teamName": "IBK Falken P13",
    "pointsTotal": 1280,
    "rank": 3
  },
  "leaderboard": [
    { "rank": 1, "teamId": "uuid", "teamName": "IBK Härnösand P12", "pointsTotal": 2200, "isRequestingTeam": false },
    { "rank": 2, "teamId": "uuid", "teamName": "Sundsvall Innebandy P13", "pointsTotal": 1800, "isRequestingTeam": false },
    { "rank": 2, "teamId": "uuid", "teamName": "Örnsköldsvik IBK", "pointsTotal": 1800, "isRequestingTeam": false },
    { "rank": 4, "teamId": "uuid", "teamName": "IBK Falken P13", "pointsTotal": 1280, "isRequestingTeam": true }
  ]
}
```

- Every team with a currently-`active` `TeamSeasonPot` appears exactly
  once; a team with none is simply absent (see the ADR's Decision 1) — not
  shown at zero, not an error.
- **Standard competition ranking** — ties share the lower rank number, the
  next distinct score skips accordingly (see the example: two teams tied
  at `1800` both rank `2`, the next team ranks `4`, not `3`).
- Sorted descending by `pointsTotal`; `rank` is precomputed server-side and
  identical between the `leaderboard` array and `requestingTeam.rank` — the
  client never derives rank itself.
- `requestingTeam` is `null` if the calling team currently has no active
  pot — the rest of the leaderboard still returns (deliberately more
  graceful than the dashboard endpoint's `500`-on-missing-pot behavior; see
  the ADR's Decision 3).
- `teamId`/`isRequestingTeam` are included for client convenience (stable
  list keys, highlighting the viewer's own row) — **no player-level data of
  any kind appears anywhere in this response**, for any team, which is this
  endpoint's one hard, non-negotiable requirement.

### 1a. The effort view (additive, ADR-0016)

Same endpoint, same response — `requestingTeam`/`leaderboard` above are
**unchanged, byte-for-byte**. Two new top-level fields are added alongside
them:

```json
{
  "requestingTeam": { "...": "unchanged, see above" },
  "leaderboard": [ "...": "unchanged, see above" ],

  "requestingTeamEffort": {
    "teamId": "uuid",
    "teamName": "IBK Falken P13",
    "eligiblePlayerCount": 6,
    "pointsPerPlayer": 150.0,
    "adjustedScore": 176.9,
    "rank": 4
  },
  "effortLeaderboard": [
    { "rank": 1, "teamId": "uuid", "teamName": "IBK Falken P13 B-lag", "eligiblePlayerCountRange": "3-5", "pointsPerPlayer": 300.0, "adjustedScore": 231.4, "isRequestingTeam": false },
    { "rank": 2, "teamId": "uuid", "teamName": "IBK Härnösand P12", "eligiblePlayerCountRange": "6+", "pointsPerPlayer": 200.0, "adjustedScore": 199.0, "isRequestingTeam": false },
    { "rank": 3, "teamId": "uuid", "teamName": "Sundsvall Innebandy P13", "eligiblePlayerCountRange": "6+", "pointsPerPlayer": 180.0, "adjustedScore": 187.6, "isRequestingTeam": false },
    { "rank": 4, "teamId": "uuid", "teamName": "IBK Falken P13", "eligiblePlayerCountRange": "6+", "pointsPerPlayer": 176.9, "adjustedScore": 176.9, "isRequestingTeam": true }
  ]
}
```

- **`eligiblePlayerCount`** (on `requestingTeamEffort` and the dashboard/
  `GET /players/me` fields below — never `effortLeaderboard`) reuses
  ADR-0015 Decision 2's exact eligibility predicate
  (`parentalConsentStatus = 'approved' AND teamJoinStatus = 'approved'`) —
  the same "could this player plausibly have logged training" gate already
  used for the weekly goal.
- **`eligiblePlayerCountRange`** (on `effortLeaderboard` rows only) is that
  same count **bucketed** into `'1-2' | '3-5' | '6+'`, not an exact
  integer — per ADR-0016's 2026-07-31 addendum: an exact count on a
  cross-team-visible row for a 1–2 player team is a de-facto single,
  identifiable child's parental-consent/join-approval status, which is a
  child-privacy leak this project treats as blocking. `requestingTeamEffort`
  and the dashboard/`GET /players/me` `eligiblePlayerCount` fields never
  cross a team boundary (always the requester's own team), so they are
  unaffected and stay exact integers.
- **`pointsPerPlayer`** is the honest, unadjusted `pointsTotal /
  eligiblePlayerCount`, one decimal.
- **`adjustedScore`** is the shrinkage-adjusted number `rank` is actually
  computed from — see ADR-0016 Decision 2 for the formula (`(n / (n + k)) *
  teamAverage + (k / (n + k)) * C`, `C`/`k` derived live from the current
  league's own data) and its worked example (a 15-person team's raw total
  no longer automatically wins the effort view; a 4-person team with a
  higher genuine per-player rate can outrank it once shrinkage pulls both
  toward the league mean in proportion to their sample size).
- Same **standard competition ranking** tie-handling as `leaderboard`
  above, computed once server-side against `adjustedScore` so
  `effortLeaderboard` and `requestingTeamEffort.rank` agree by
  construction.
- A team with `eligiblePlayerCount === 0` (every player still
  consent-pending, or a self-created team with no approved joiner yet) is
  **absent from `effortLeaderboard` entirely** — same "absent, not shown at
  zero" posture as a team with no active pot on the raw leaderboard above.
- `requestingTeamEffort` is `null` if the requesting team's own
  `eligiblePlayerCount` is `0` — same posture as `requestingTeam`'s own
  `null` case for a missing pot.
- **No player-level data of any kind appears here either** — the query
  behind this view joins to `Player` for a `COUNT` only (see ADR-0016
  Decision 4); no `screenName`/`playerId`/consent field is ever selected.

---

## Breaking changes to existing shapes

### `GET /api/v1/players/me` (`phase1-contract.md`) — `teamPool` block

**Before:**
```json
"teamPool": {
  "seasonId": "uuid", "seasonLabel": "Vår 2026",
  "pointsTotal": 1280, "goalThreshold": 5000, "percentComplete": 25.6,
  "status": "active"
}
```

**After** — `goalThreshold`/`percentComplete` removed, `rank`/`teamCount`
added:
```json
"teamPool": {
  "seasonId": "uuid", "seasonLabel": "Vår 2026",
  "pointsTotal": 1280, "status": "active",
  "rank": 3, "teamCount": 4
}
```

**Updated 2026-07-31 (ADR-0016, additive)** — `effortRank`/
`eligiblePlayerCount` added alongside `rank`/`teamCount`, same posture as
endpoint 1a above (`effortRank: null` when this team's own
`eligiblePlayerCount` is `0`):
```json
"teamPool": {
  "seasonId": "uuid", "seasonLabel": "Vår 2026",
  "pointsTotal": 1280, "status": "active",
  "rank": 3, "teamCount": 4,
  "effortRank": 4, "eligiblePlayerCount": 6
}
```

### `GET /api/v1/teams/:teamId/dashboard` (`phase2-contract.md`) — `teamPool` block

Same change as above, applied to the dashboard's existing `teamPool` block
(currently identical shape). `rank`/`teamCount` computed the same way:
`rank` = 1 + count of active pots with a strictly greater `pointsTotal`
(tie-consistent with the leaderboard endpoint's own ranking, computed the
same way, not derived differently in two places); `teamCount` = count of
teams currently on the leaderboard at all. `effortRank`/
`eligiblePlayerCount` (ADR-0016, additive, 2026-07-31) are added the same
way, computed by the same shared `TeamPoolService` method the leaderboard
endpoint's `effortLeaderboard` reuses.

### `POST /api/v1/training-logs` (`phase1-contract.md` + `phase2-contract.md`)

**Before:**
```json
"teamPool": { "pointsTotal": 1280, "goalThreshold": 5000, "percentComplete": 25.6 }
```

**After:**
```json
"teamPool": { "pointsTotal": 1280 }
```

`goalThreshold`/`percentComplete` removed; **`rank` is deliberately not
added here** — computing a system-wide rank on this app's hottest write
path is a real, avoidable cost (see the ADR's Decision 3). A client that
wants an updated rank after logging re-fetches `GET /players/me` or the
dashboard, same as it already does for other post-log state.

**`effortRank`/`eligiblePlayerCount` (ADR-0016) are, for the identical
reason, also deliberately not added here** — same hot-path posture, not an
oversight. A client wants an updated `effortRank` the same way it already
gets an updated `rank`: on its next `GET /players/me` or dashboard fetch.

### `TeamSeasonPot.goal_threshold` (schema)

**Not dropped.** The column stays in Postgres, unused, `NOT NULL` — same
posture as the dormant `Coach`/`TeamCoach` tables and
`TrainingLogEntry.challenge_id`. No migration needed for this ADR beyond
whatever `docs/database/migrations/` entry stops *reading* it in the
three response builders above.

---

## Notes for implementers

- **backend-developer:** implement `rank`/`teamCount` as one shared query
  method (e.g. on `TeamPoolService`), used by the dashboard, `GET
  /players/me`, and the leaderboard endpoint — not three slightly different
  computations, matching this project's existing "don't duplicate the
  aggregate" convention (see `phase2-contract.md`'s equivalent note about
  the weekly-goal progress query).
- **backend-developer:** confirm nothing else in the codebase (e.g. any
  test fixture, the seed script's printed summary) still asserts on
  `goalThreshold`/`percentComplete` in these three responses after the
  change — this is a real removal, not an additive field.
- **frontend-developer:** every screen currently rendering a "percent to
  goal" bar/number against the top-level team-pool meter (per
  `mobile/README.md`'s consolidation-candidates note on `TeamPoolCard`) needs
  to change to a rank-based framing — this is not just "add a new
  leaderboard screen," it's also removing the existing goal-bar rendering
  path.
- **frontend-developer:** tapping the team-pool card (wherever it lives
  today) should navigate to a new leaderboard screen backed by endpoint 1
  above — exact screen design is ux-designer's pass, not fixed here.
- **ux-designer:** the button/card copy "Lagets VM-Guld-pott" needs a new
  name — the project owner flagged this explicitly and deferred the actual
  wording; pick one as part of the flow-design pass for this phase, it's
  not decided anywhere in this contract or its ADR.
- **security-reviewer:** confirm `Team.name` — the one field now crossing
  a team boundary for the first time — carries no sensitive content in any
  seeded/real team today; confirm the leaderboard query genuinely never
  joins to `Player`/`PlayerPrivateInfo` (should be visible directly from
  the query's `FROM`/`JOIN` clauses, per the ADR's Decision 1); confirm the
  season-basis fairness limitation (ADR Decision 2) is an acceptable,
  explicitly-agreed gap for the current beta, not silently inherited.
- **code-critic:** the rank/tie computation (competition ranking, shared
  between the leaderboard list and each team's own `rank` field) is the
  one piece of genuinely new logic here — worth checking directly against
  a hand-worked example with ties, same scrutiny level as Phase 2's
  goal-bonus crossing logic got.

### ADR-0016 addendum (2026-07-31) — the effort view, additive

Implemented against `TeamPoolService`/`WeeklyGoalController`'s existing
leaderboard endpoint (see endpoint 1a above), not a new endpoint or a new
contract doc — this is purely additive to what's already specified above.

- **backend-developer:** `TeamPoolService.getEffortLeaderboard()` (a new
  count-only join to `Player` — see ADR-0016 Decision 4) and
  `TeamPoolService.getEffortRankAndEligibleCountOrThrow()` are the shared
  query/computation methods, mirroring `getLeaderboard()`/
  `getRankAndTeamCountOrThrow()`'s existing pattern rather than
  duplicating it. `computeEffortLeaderboard()` (the shrinkage
  formula/ranking, a pure static function) is unit-tested directly against
  ADR-0016's own worked example (`team-pool.service.spec.ts`), same
  posture as `computeStandardCompetitionRanks`.
- **security-reviewer:** ADR-0016 Decision 4 explicitly flags this as the
  first cross-team query to ever join to `Player` at all (even count-only)
  — sign-off required before ship, same posture ADR-0008's own first-time
  `Team.name` exposure got. Confirm the query genuinely selects nothing
  from `Player` except the `COUNT` (no `screenName`/`playerId`/consent
  field anywhere in the `SELECT`).
- **Not a coordinated-deploy item, unlike ADR-0005/ADR-0015** — this is
  additive only (no existing field's meaning changes), so
  frontend-developer can ship the effort-view tab on its own schedule once
  these fields exist; no shared deploy window required.
- **ux-designer/frontend-developer:** the tab/toggle between "Mest poäng"
  (existing `leaderboard`) and "Bästa laginsats" (new `effortLeaderboard`)
  is a separate, later pass — not built as part of this addendum.
