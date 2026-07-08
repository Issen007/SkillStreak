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

### `GET /api/v1/teams/:teamId/dashboard` (`phase2-contract.md`) — `teamPool` block

Same change as above, applied to the dashboard's existing `teamPool` block
(currently identical shape). `rank`/`teamCount` computed the same way:
`rank` = 1 + count of active pots with a strictly greater `pointsTotal`
(tie-consistent with the leaderboard endpoint's own ranking, computed the
same way, not derived differently in two places); `teamCount` = count of
teams currently on the leaderboard at all.

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
