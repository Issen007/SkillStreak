# Phase 2 API Contract — Kapten, weekly team goal, session reissue

## Status

Draft for Phase 2 build — architect-owned, for backend-developer/
frontend-developer to build against. Same rigor as
`docs/api/phase1-contract.md`: endpoint list + request/response shapes +
the sequencing/state-machine rules that matter, not a full OpenAPI spec.

**This replaces the previous coach-dashboard version of this document
wholesale**, following the project owner's pivot away from a separate adult
"Coach" concept to a player-captain ("Kapten") who uses their existing
player account. See
[`docs/adr/0005-kapten-and-weekly-team-goal.md`](../adr/0005-kapten-and-weekly-team-goal.md)
(read first — this doc assumes its schema/decisions) and
[`docs/adr/0004-coach-auth-and-session-reissue.md`](../adr/0004-coach-auth-and-session-reissue.md)'s
2026-07-05 addendum for why the old coach-auth endpoints below no longer
exist. Part 3 of ADR-0004 (player `token_version` + session-reissue code)
is unaffected and still governs the session-reissue endpoint's mechanism —
only its caller changes (captain, not coach).

Builds on `phase1-contract.md`, doesn't replace it — Phase 1's four
endpoints (`GET /teams/invite/:inviteCode`, `POST /players`,
`POST /training-logs`, `GET /players/me`) are unchanged, **including
`POST /training-logs`'s request shape** — see that endpoint's section below
for the one *response* addition it gets in Phase 2.

## Conventions

- Base path: `/api/v1` (unchanged).
- **One auth universe, not two.** Every endpoint below uses the existing
  `Authorization: Bearer <playerSessionToken>`, verified by the existing
  `JwtAuthGuard` against `JWT_SECRET`, including ADR-0004 Part 3's
  `token_version` check. There is no coach token, no `COACH_JWT_SECRET`, no
  `CoachAuthGuard`. Every endpoint populates `request.playerId` exactly as
  Phase 1 already does.
- **Team-scoped endpoints** (path has a `:teamId`) additionally require
  `request.playerId`'s own `player.teamId === :teamId` — `403
  team_mismatch` otherwise. This is the same closed-team-bubble rule Phase
  1 already applies everywhere; it is *not new machinery*, just restated
  here because these are the first team-scoped-by-path-param endpoints.
- **Captain-gated endpoints** (creating/editing the weekly goal, the roster
  view, consent-reminder resend, session reissue) additionally require the
  requesting player's own `is_captain = true` — `403 not_team_captain`
  otherwise. This is a **service-layer check, not a new guard class** (see
  ADR-0005, Decision 1): load the requester's `Player` row (already
  necessary for the `team_mismatch` check above), verify the flag, done.
  No `CaptainGuard` decorator/class exists or is needed.
- Error envelope unchanged from Phase 1:
  ```json
  { "error": { "code": "some_code", "message": "Human-readable, dev-facing" } }
  ```
- "Day"/date rules (Europe/Stockholm, server-computed) and the
  no-location-field rule carry over unchanged from Phase 1's conventions.
- Every response shape below shows `screenName`, never `realName` or
  `parentContact` (still isolated in `PlayerPrivateInfo`, per ADR-0002's
  addendum). This was true of the old coach-only screens too, and remains
  true now that a captain — who has **no elevated data access beyond any
  other player** — can see them: nothing about being captain grants access
  to `PlayerPrivateInfo`. There is no coach-specific concern to relax here;
  the boundary was always structural (module-level), not a coach-vs-player
  distinction, so it needs no new enforcement for this pivot.

---

## Endpoints removed from this contract (superseded)

The following, from the previous version of this document, are **removed,
not deprecated** — nothing below exists to build:

- `POST /api/v1/coach/auth/login`
- `POST /api/v1/coach/auth/password-reset/request`
- `POST /api/v1/coach/auth/password-reset/confirm`
- `CoachAuthGuard`, `CoachTeamAccessGuard`, `CurrentCoachId` decorator
- The `coach-auth` module and the `COACH_JWT_SECRET` env var

See ADR-0004's 2026-07-05 addendum for the full reasoning.

---

## Endpoints

### 1. `GET /api/v1/teams/:teamId/dashboard`

Player auth; `team_mismatch` check (any player on the team can view their
own team's dashboard — not captain-gated, since nothing here is
sensitive beyond what the roster view separately protects). One call,
per Phase 1's "no extra round-trip" principle — replaces the old coach-only
dashboard endpoint with a version any team member can load.

Response `200`:
```json
{
  "viewerIsCaptain": true,
  "roster": {
    "totalCount": 16,
    "approvedCount": 12,
    "pendingCount": 3,
    "revokedCount": 1
  },
  "teamPool": {
    "seasonId": "uuid",
    "seasonLabel": "Vår 2026",
    "pointsTotal": 1280,
    "goalThreshold": 5000,
    "percentComplete": 25.6,
    "status": "active",
    "last7DaysLoggedCount": 11
  },
  "weeklyGoal": {
    "current": {
      "id": "uuid",
      "title": "Zorro-finter-veckan",
      "description": "Gör så många zorro-finter du kan innan fredag!",
      "targetMetric": "drill-minuter",
      "targetValue": 600,
      "startDate": "2026-07-06",
      "endDate": "2026-07-12",
      "status": "active",
      "progressMinutes": 420,
      "percentComplete": 70.0,
      "goalMet": false,
      "bonusAwardedAt": null
    },
    "pastCount": { "completed": 3, "cancelled": 1 }
  }
}
```

`weeklyGoal.current` is `null` if the team has no `active` goal and no
unpublished `draft` either. If there's no `active` goal but a `draft`
exists (a captain mid-way through building next week's goal), `current`
returns that draft instead (so a captain resuming the builder doesn't need
a second call) — `status: "draft"` distinguishes it; a non-captain viewer
simply sees "no goal yet" copy for a draft, per the flows doc's judgment
call to make (ux-designer follow-up, not fixed here).

`roster.*Count` fields: unchanged from the old dashboard shape (Phase 1's
`ParentalConsentStatus` breakdown). `teamPool.*`: unchanged shape from
`GET /players/me`'s existing `teamPool` block.

### 2. `GET /api/v1/teams/:teamId/roster`

Player auth + captain check (`403 not_team_captain` for a non-captain).
Same shape as the old coach-only roster endpoint — reused verbatim, since
nothing about the *data* was ever coach-specific, only who could see it.

Response `200`:
```json
{
  "players": [
    {
      "playerId": "uuid",
      "screenName": "FloorballStar15",
      "avatarId": "fox",
      "consentStatus": "approved",
      "lastTrainedDate": "2026-07-04"
    }
  ]
}
```

`lastTrainedDate` is `null` if the player has never logged. Remains
captain-gated rather than opened to every teammate: consent status is
about *other kids'* families and is a reasonable thing to keep restricted
to the one player-role with a legitimate "keep an eye on the team" purpose,
even though that role is now a peer rather than an adult (see ADR-0005's
Consequences — flagged for security-reviewer).

### 3. `POST /api/v1/players/:playerId/consent-reminder`

Player auth + captain check: the service resolves `playerId → teamId` and
requires the *requester* to be that team's captain (`403
not_team_captain`) — note this is **not** "requester is the target
player," a captain triggers this for a teammate. Same behavior as the old
coach-triggered version otherwise.

Request: none (empty body).

Response `200`:
```json
{ "message": "Reminder sent.", "sentAt": "2026-07-05T10:00:00Z" }
```

Behavior unchanged from the previous contract: only valid while
`parentalConsentStatus = pending` (`409 consent_not_pending` otherwise),
reuses `consent_token`/`consent_token_expires_at`, rate-limited per player
(e.g. one reminder per 5 minutes — exact window still backend-developer's
call).

**Flagged for security-reviewer** (carried from ADR-0005's Consequences):
this now sends a real email nudge to a teammate's parent, triggered by
another child rather than an adult coach. The mechanism/rate-limiting is
identical to the old design; the trust model triggering it is not, and
deserves an explicit sign-off rather than inheriting the old review.

### 4. `POST /api/v1/players/:playerId/session-reissue`

Player auth + captain check, same `playerId → teamId` resolution as
endpoint 3. **Mechanism is entirely unchanged from ADR-0004 Part 3** — only
the caller's authorization changed (captain via player JWT, not coach via
`CoachAuthGuard`).

Request: none.

Response `200`:
```json
{ "reissueCode": "H4K7QWXP", "expiresAt": "2026-07-05T10:15:00Z" }
```

Side effects (one transaction, per ADR-0004 Part 3): increments
`player.token_version` (invalidating every existing token for the target
player immediately), generates+stores a fresh
`session_reissue_code`/`_expires_at` (15-minute TTL, overwriting any prior
unredeemed code). Frontend renders `reissueCode` prominently on the
captain's confirmation screen (same UX note as before: this is a
*displayed* code, not something sent through a separate channel).

**Also flagged for security-reviewer**, same reasoning as endpoint 3: a
captain now holds a button that can invalidate a teammate's session and
generate a login code for them. Worth confirming this is an acceptable
level of peer trust for this feature before it ships (the reissue-code
entropy/TTL/throttle combination itself is unchanged from ADR-0004 and
doesn't need re-review on its own).

---

### Weekly team goal

State machine (enforced server-side, unchanged from the original design):
`draft → active → completed | cancelled`. No other transition is legal.
`targetMetric`, `targetValue`, `startDate`, `endDate` are frozen the moment
`status` leaves `draft`; only `draft` goals accept `PATCH` changes to those
fields. **New in this version:** at most one goal per team may be `active`
at a time (DB-enforced, ADR-0005 Decision 2) — activating a second one
while one is already active is rejected.

#### 5. `POST /api/v1/teams/:teamId/weekly-goal`

Player auth + captain check (`403 not_team_captain`). Creates a new goal
row (the `Challenge` entity, reused — see ADR-0005) with
`createdByPlayerId` set to the requester.

Request:
```ts
{
  title: string;
  description: string;
  targetMetric: 'fitness-minuter' | 'drill-minuter' | 'running-minuter' | 'other-minuter' | 'total-minuter';
  targetValue: number;       // positive integer, minutes
  startDate: string;         // ISO date
  endDate: string;           // ISO date, must be > startDate
  status: 'draft' | 'active'; // only these two are legal at creation
}
```

Response `201`: the goal row, camelCase (`id`, `teamId`,
`createdByPlayerId`, `title`, `description`, `targetMetric`, `targetValue`,
`startDate`, `endDate`, `status`) — no progress fields yet at creation
(there's nothing to compute for a brand-new goal until it's `active` and
some time has passed; `GET` endpoints below always include progress).

Errors: `400` validation (`targetMetric` not in the fixed enum, `endDate` ≤
`startDate`, `status` anything other than `draft`/`active` at creation);
`409 active_goal_already_exists` if `status: "active"` is requested while
the team already has an `active` goal (creating another `draft` in this
situation is fine and not an error).

#### 6. `PATCH /api/v1/teams/:teamId/weekly-goal/:id`

Player auth + captain check. Request (all fields optional):

```ts
{
  title?: string;
  description?: string;
  targetMetric?: string;
  targetValue?: number;
  startDate?: string;
  endDate?: string;
  status?: 'active' | 'completed' | 'cancelled';
}
```

Rules, enforced server-side:
- If the current row's `status !== 'draft'`: any attempt to change
  `targetMetric`, `targetValue`, `startDate`, or `endDate` is rejected —
  `409 challenge_target_frozen`, even for a no-op identical value (simplest
  rule, and — per ADR-0005 — closes off a captain shrinking the target
  mid-week to trigger the bonus early). `title`/`description` may be edited
  at any non-terminal status.
- `status` transitions accepted: `draft → active`, `active → completed`,
  `active → cancelled`. Anything else is `409 invalid_challenge_transition`.
- `draft → active` additionally fails with `409 active_goal_already_exists`
  if the team already has a different `active` goal.
- `active → completed` is modeled as available (a captain action, or a
  future automatic end-of-day sweep once `endDate` passes) — this contract
  doesn't mandate who/what calls it, same as the original design.

Response `200`: the updated goal row, same shape as endpoint 5's response.

#### 7. `GET /api/v1/teams/:teamId/weekly-goal`

Player auth; `team_mismatch` check only — **open to any player on the
team, not captain-gated.** Progress is a team-wide number every teammate
should be able to see (that's the point of the feature), unlike the roster
view.

Response `200`:
```json
{
  "goal": {
    "id": "uuid",
    "title": "Zorro-finter-veckan",
    "description": "Gör så många zorro-finter du kan innan fredag!",
    "targetMetric": "drill-minuter",
    "targetValue": 600,
    "startDate": "2026-07-06",
    "endDate": "2026-07-12",
    "status": "active",
    "createdByPlayerId": "uuid",
    "progressMinutes": 420,
    "percentComplete": 70.0,
    "goalMet": false,
    "bonusAwardedAt": null,
    "bonusPointsAwarded": null
  },
  "viewerIsCaptain": true
}
```

`goal` is `null` (not an error) if the team has no `active` goal and no
`draft` either. `progressMinutes`/`percentComplete`/`goalMet` are computed
server-side from the team-wide aggregate (ADR-0005's formula) — never
trusted from any client state. `viewerIsCaptain` lets the client show
management actions (edit/publish/cancel) without a second call.

**`bonusAwardedAt`/`bonusPointsAwarded` — added 2026-07-05** so a teammate
who *didn't* trigger the bonus (i.e. opens the app after someone else's log
already crossed the threshold) can still see the exact amount, per
`docs/design/phase2-flows.md`'s Screen G3. `bonusPointsAwarded` is the same
`5 + progress-at-crossing-time` value computed once in
`TrainingLogsService.logTraining`'s transaction (ADR-0005 Decision 3) and
persisted alongside `bonusAwardedAt`, not re-derived — a client-side guess
like `5 + targetValue` would be wrong, since crossing-time progress almost
always exceeds `targetValue` by however many minutes the crossing log
contributed. Both fields are `null` until the bonus fires, then permanent
for that goal (never cleared, matches `bonusAwardedAt`'s existing
never-clawed-back semantics). Same two fields also appear on each entry in
endpoint 8's history list.

#### 8. `GET /api/v1/teams/:teamId/weekly-goal/history`

Player auth; `team_mismatch` check only. Backs a simple past-goals list —
no pagination, matching the existing "a team has a handful of these at a
time" scale assumption.

Response `200`:
```json
{ "goals": [ /* goal rows, same shape as endpoint 7's `goal`, newest first, status completed|cancelled only */ ] }
```

---

### `POST /api/v1/training-logs` (existing Phase 1 endpoint)

**Request shape is completely unchanged from `phase1-contract.md`:**
`{ activityType, durationMinutes, challengeId? }`. `challengeId` remains
accepted and stored exactly as Phase 1 already does — **no new validation
is added for it in Phase 2.** Per ADR-0005 Decision 2: the weekly team
goal's progress is computed automatically from every matching log in its
date range, with no per-log tagging step, so there is nothing for
`challengeId` to opt a log into for this feature. `challengeId` stays a
dormant, unused, nullable column — unchanged from its Phase 1 status —
available to a possible future *individual*-challenge feature, not wired
to anything in Phase 2.

**Response shape gains one new field**, computed inside the same
transaction as the existing streak/pool logic (ADR-0005, Decision 3):

```ts
{
  trainingLogId: string;
  loggedAt: string;
  streak: { currentStreakCount: number; longestStreakCount: number; alreadyLoggedToday: boolean }; // unchanged
  teamPool: { pointsTotal: number; goalThreshold: number; percentComplete: number }; // unchanged shape; pointsTotal already reflects any bonus below
  goalBonus: { awardedPoints: number } | null; // NEW
}
```

**Corrected 2026-07-05**: the bonus is a one-time lump sum (flat +5, plus 1
point per team-wide minute logged toward the goal), not a per-log or
ongoing bonus — see ADR-0005 Decision 3's correction note for why this
changed from the original "+5 per log" design.

- `null`: no `active` weekly goal covers this log's date, the team's
  progress (including this log) is still below `targetValue`, or the goal
  was already met by an earlier log (nothing new to report this time —
  the bonus only ever fires once per goal).
- `{ awardedPoints: N }`: this log's insertion caused the team to cross
  `targetValue` for the first (and only) time; `N = 5 + progress` (flat +5,
  plus 1 point per team-wide minute — `progress` is the same team-wide
  minute sum just computed for the target check). Because this only ever
  fires once per goal, a non-null `goalBonus` unambiguously means "this log
  just did it" — no separate flag needed to distinguish an "already met"
  case, since that's folded into `null` above.

Exact algorithm (row-locked read of the team's active goal, idempotency via
`goal_bonus_awarded_at`, the one-time award) is specified precisely in
ADR-0005, Decision 3 — implement against that, not a re-derivation here.

---

## Notes for implementers

- **backend-developer:** the captain check (`assertIsCaptainOfTeam`) and
  the `team_mismatch` check are both small, single-purpose service methods
  — factor each into one shared place (e.g. on `PlayersService` or a new
  small `WeeklyGoalService`), called from every endpoint above that needs
  it, rather than reimplemented per controller.
- **backend-developer:** the team-wide progress aggregate (used by
  endpoints 1, 7, 8, and the bonus check in `POST /training-logs`) should
  be one shared query/service method, not four slightly different
  implementations — same "don't duplicate the aggregate" note the old
  contract made about the individual-progress version of this problem.
- **backend-developer:** the bonus-check step inside
  `TrainingLogsService.logTraining`'s existing transaction needs the
  row-locked read of the team's `active` `Challenge` **before** deciding
  whether to run the bulk award — see ADR-0005 Decision 3 for the exact
  ordering; this is what makes the idempotency guarantee hold under
  concurrent writes, not the `goal_bonus_awarded_at` check alone.
- **frontend-developer:** the captain-facing weekly-goal builder screens
  (title/description → target → dates → review, mirroring the old
  CB1-CB4 flow) and the player-facing goal card are both new builds against
  a ux-designer pass that will follow this contract — `phase2-flows.md`'s
  existing CB1-CB4/CP1 screens are a reasonable visual/copy starting point
  but their data assumptions (individual progress, coach auth) need
  updating, not a fresh design from zero.
- **frontend-developer:** the "enter your reissue code" player screen
  (ADR-0004 Part 3) is unchanged in shape from the old design — still a new
  screen with no Phase 1 equivalent — only the screen that *triggers* it
  (now a captain's roster action, not a coach's) changes.
- **security-reviewer:** blocking review before merge, per CLAUDE.md, same
  as the superseded version of this contract — but the specific things
  worth confirming have shifted: (1) a child-captain triggering
  consent-reminder-resend and session-reissue for a *teammate* (endpoints
  3-4) is a different trust model than an adult coach doing the same,
  flagged explicitly in ADR-0005's Consequences, not previously reviewed
  under this framing; (2) the `is_captain`/`active`-goal partial unique
  indexes actually prevent the two-active-captain / two-active-goal races
  they're meant to; (3) the bonus-award transaction's idempotency under
  concurrent training-log writes for the same team (a realistic scenario —
  multiple teammates logging around the same time near the end of the
  week); (4) no response above leaks `realName`/`parentContact` (unchanged
  concern from the old contract, still worth a fresh check against these
  specific new shapes).
- **code-critic:** the bonus mechanic in particular (crossing detection,
  bulk-vs-incremental award, interaction with `active → cancelled`/
  `completed`) is the most novel piece of logic in this contract — worth
  the same "edge cases: first-ever streak day, midnight rollover, missed
  day, concurrent team-pool writes" level of scrutiny Phase 1's streak/pool
  logic got, applied to goal-crossing/bonus idempotency instead.

---

## Addendum — 2026-07-08: Fas 2.6a captain transfer + teammates roster

See [`docs/adr/0006-captain-transfer.md`](../adr/0006-captain-transfer.md)
(read first — this assumes its design). Extends this contract; nothing
above is superseded.

### 9. `POST /api/v1/teams/:teamId/captain-transfer`

Player auth + captain check (`403 not_team_captain` unless the requester is
the team's *current* captain — self-service transfer, no other authority
exists to do this). Same transactional/row-lock shape as `PATCH
.../weekly-goal/:id` (ADR-0006's Decision 1).

Request:
```ts
{ newCaptainPlayerId: string; }
```

Response `200`:
```json
{
  "teamId": "uuid",
  "previousCaptainPlayerId": "uuid",
  "newCaptainPlayerId": "uuid",
  "transferredAt": "2026-07-08T10:00:00Z"
}
```

Errors:
- `403 not_team_captain` — requester is not the team's current captain.
- `409 captain_transfer_target_is_self` — `newCaptainPlayerId` equals the
  requester's own id.
- `404 player_not_found` — no such player.
- `403 captain_transfer_target_not_on_team` — `newCaptainPlayerId` exists
  but belongs to a different team.
- `409 captain_transfer_conflict` — defensive backstop for the partial
  unique index (`idx_player_one_captain_per_team`); should be unreachable
  given the transaction's row locks, kept as a fallback the same way
  `WeeklyGoalService` catches the equivalent violation for
  `idx_challenge_one_active_goal_per_team`.

### 10. `GET /api/v1/teams/:teamId/teammates`

Player auth; `team_mismatch` check only — **open to any player on the
team, not captain-gated** (ADR-0006 Decision 2: this is deliberately
narrower data than endpoint 2's roster, so it doesn't need that gate).

Response `200`:
```json
{
  "teammates": [
    { "playerId": "uuid", "screenName": "FloorballStar15", "avatarId": "fox", "isCaptain": true }
  ]
}
```

No `consentStatus`, no `lastTrainedDate`, no `realName`/`parentContact` —
this endpoint's entire purpose is "who's on my team and who's captain,"
nothing more. Use endpoint 2 (`GET .../roster`, still captain-gated) for
consent/last-trained detail.

### Endpoint 2 (`GET .../roster`) response — additive field

Each entry in the existing captain-gated roster response gains `isCaptain:
boolean` — additive, non-breaking. A captain no longer needs a second call
to confirm their own status.

### Notes for implementers

- **backend-developer:** `PlayersService.transferCaptaincy` is new; the
  controller endpoint is a new method on the existing `WeeklyGoalController`
  (it already owns every other `/api/v1/teams/:teamId/...` route in this
  contract) delegating straight to `PlayersService`, not to
  `WeeklyGoalService` — the logic only touches `Player`, no dependency on
  `Challenge`/`TeamSeasonPot`.
- **frontend-developer:** the roster/teammates screen needs a "transfer
  captaincy" action visible only when `viewerIsCaptain` (from the dashboard
  response) is `true`, targeting another player from either endpoint 9's
  teammates list or the existing captain-only roster.
- **ux-designer:** whether the outgoing/incoming captain get any explicit
  in-app notification of a transfer (vs. just seeing `viewerIsCaptain` flip
  on next load) is not decided here — see ADR-0006's Consequences.
- **security-reviewer:** confirm a captain who has just transferred away
  immediately loses access to every other captain-gated action on their
  next call (the flag is re-checked per-request, not cached) — see
  ADR-0006's Consequences for the exact concern.
