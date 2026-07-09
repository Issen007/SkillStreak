# Phase 1 API Contract — Expo app ↔ NestJS backend

## Status

Draft for Phase 1 build — architect-owned, for frontend-developer and
ux-designer to build against. Not a full OpenAPI spec: this is the
endpoint list, request/response shapes, and the sequencing that matters,
per `docs/adr/0002-data-model.md` (including its 2026-07-03 addendum,
which this contract assumes).

Out of scope for Phase 1 (don't build against these yet):
- Coach self-serve team/invite-code creation (Phase 2's coach dashboard).
  For Phase 1, assume a `Team` + `invite_code` already exists via a
  backend-developer seed/admin step. **Superseded for the "no matching
  team" case by the 2026-07-09 addendum below** — the invite-code preview
  step's `404` no longer has to be a dead end; ordinary seed/admin team
  creation is otherwise unchanged.
- Challenges (`challengeId` is accepted as an optional field below since
  the column exists per ADR-0002, but no challenge-management endpoints
  exist yet).
- Badges, the video feed, coach-facing endpoints generally.

## Conventions

- Base path: `/api/v1`.
- Auth: `Authorization: Bearer <sessionToken>` on every endpoint except
  `GET /teams/invite/:inviteCode` and `POST /players`. `sessionToken` is a
  JWT scoped to a single `playerId`, issued at `POST /players` — there is
  no separate login step (no password, no email/OTP for the child) since
  the account is created coach-mediated, in person. Token lifecycle
  (expiry/refresh/reissue-if-lost) is a backend-developer implementation
  detail; this contract only fixes that the token exists and is a bearer
  token.
- Errors use a consistent envelope:
  ```json
  { "error": { "code": "consent_required", "message": "Human-readable, for logs/debugging, not shown verbatim to a 9-year-old" } }
  ```
  Client UI copy should be driven off `error.code`, not `error.message`
  (that's ux-designer's/i18n's job — messages here are English/dev-facing
  per CLAUDE.md's language notes).
- "Day" boundaries (streak increment, "already logged today") are computed
  server-side against a fixed timezone (Europe/Stockholm), never the
  device's local clock/timezone — prevents a kid changing their phone's
  clock/timezone to game a streak, and keeps the rule consistent for a
  Swedish-only user base for now.
- No endpoint here accepts or returns any location/geo field. If a future
  PR adds one to any of these shapes, that's a constraint violation to
  block on, not a design gap to fill.

## Onboarding sequence

1. Coach shares the team's `invite_code` out of band (spoken/written at
   practice) — no endpoint needed for this in Phase 1. **Or**, per the
   2026-07-09 addendum below, a player whose code doesn't match anything
   can create a new team instead, becoming its first player and captain.
2. App calls `GET /api/v1/teams/invite/:inviteCode` to preview the team
   ("Ansluter du till IBK Falken?") before committing to anything.
3. Kid picks a `screenName` + `avatarId`; app also collects `birthYear`
   and a `parentContact` (coach-facilitated — exact UX of *whose* device
   enters this is ux-designer's call). App calls `POST /players`.
4. Backend creates the `Player` row immediately (per ADR-0002 addendum
   §2, this is the "shell" step — no consent wait), sets
   `parentalConsentStatus = pending`, writes the first
   `ParentalConsentRecord`, and (backend-developer's implementation,
   outside this contract) sends a consent request to `parentContact`.
   Response includes `sessionToken` and `consentStatus: "pending"`.
5. App stores `sessionToken` (Expo SecureStore) and navigates to the home
   screen. `consentStatus` drives a "waiting for parent approval" banner;
   the "Jag har tränat" button should be disabled client-side using this
   flag, but the server enforces it independently (see endpoint 3 below) —
   never trust client state alone for the gate.
6. Parent approves via a separate, parent-facing web link
   (`GET`/`POST /api/v1/consent/:consentToken`) — **not** part of the Expo
   app's contract, mentioned here only so frontend-developer knows it's a
   different surface, not a missing screen in this app.
7. App polls `GET /players/me` on foreground/app-open; once
   `consentStatus` flips to `approved`, the button becomes active. No push
   notifications in Phase 1 — poll-on-open is enough at this scale.

## Endpoints

### 1. `GET /api/v1/teams/invite/:inviteCode`

Preview a team before joining. No auth (a device doesn't have a token yet
at this point).

Response `200`:
```json
{ "teamId": "uuid", "teamName": "IBK Falken P13" }
```

Response `404` (unknown/invalid code) — deliberately generic, doesn't
hint whether a code is "close" to valid:
```json
{ "error": { "code": "invite_code_not_found", "message": "..." } }
```

**Unchanged by the 2026-07-09 addendum** — see that section for why this
`404`'s existing meaning ("no team matches this code") already doubles as
"this code is available to create a team with," with no new field needed.

### 2. `POST /api/v1/players`

Create the onboarding "shell" (join team + profile) and kick off the
consent flow. No auth.

Request:
```ts
{
  inviteCode: string;
  screenName: string;      // unique within the team; server 409s on collision
  avatarId: string;
  birthYear: number;       // year only, per ADR-0002 — never a full DOB
  parentContact: string;   // email or phone
}
```

Response `201`:
```json
{
  "playerId": "uuid",
  "teamId": "uuid",
  "screenName": "FloorballStar15",
  "avatarId": "fox",
  "consentStatus": "pending",
  "sessionToken": "eyJ..."
}
```

Errors: `404 invite_code_not_found`, `409 screen_name_taken_in_team`,
`400` validation (e.g. `birthYear` out of a sane range).

**See the 2026-07-09 addendum below for this endpoint's self-service-team-
creation extension** (a new optional request field, three new response
fields, two new error codes) — kept here only in its original Phase 1
shape for historical clarity; the addendum is the current, additive
superset.

### 3. `POST /api/v1/training-logs`

The "Jag har tränat" tap — the core loop. Auth required. Creates a
`TrainingLogEntry` and returns *everything* the home screen needs to
update (streak + team pool) in one response, so the client never needs a
second round-trip to refresh both widgets after logging.

Request:
```ts
{
  activityType: 'fitness' | 'drill' | 'running' | 'other';
  durationMinutes: number;
  challengeId?: string;   // optional FK; accepted now, not consumed by anything yet
}
```

Response `201`:
```json
{
  "trainingLogId": "uuid",
  "loggedAt": "2026-07-03T14:32:00Z",
  "streak": {
    "currentStreakCount": 4,
    "longestStreakCount": 9,
    "alreadyLoggedToday": false
  },
  "teamPool": {
    "pointsTotal": 1280,
    "goalThreshold": 5000,
    "percentComplete": 25.6
  }
}
```

**Same-day-logging rule** (fixed here so frontend/backend/code-critic don't
each guess separately — see ACTION_PLAN.md's flagged edge cases): a player
may log more than once per day (e.g. fitness *and* drills), and every log
contributes to `teamPool.pointsTotal` and any tagged challenge. But
`currentStreakCount` only increments on the **first** log of a new
Stockholm-time day; subsequent same-day logs still return `201` with
updated `teamPool` figures, but `streak.alreadyLoggedToday: true` and
unchanged streak counts.

Error `403` — consent not yet approved (ADR-0002 addendum §2):
```json
{ "error": { "code": "consent_required", "message": "Parental consent is pending or not requested" } }
```
Client should treat this as authoritative even if it thought
`consentStatus` was approved (stale local state) — re-fetch
`GET /players/me` and update the banner.

### 4. `GET /api/v1/players/me`

Fetch everything the home screen needs on app open/foreground, in one
call — mirrors the "no second round-trip" principle from endpoint 3.
Auth required.

Response `200`:
```json
{
  "player": {
    "id": "uuid",
    "screenName": "FloorballStar15",
    "avatarId": "fox",
    "consentStatus": "pending" // "not_requested" | "pending" | "approved" | "revoked"
  },
  "team": {
    "teamId": "uuid",
    "teamName": "IBK Falken P13"
  },
  "streak": {
    "currentStreakCount": 4,
    "longestStreakCount": 9,
    "lastTrainedDate": "2026-07-03",
    "alreadyLoggedToday": true
  },
  "teamPool": {
    "seasonId": "uuid",
    "seasonLabel": "Vår 2026",
    "pointsTotal": 1280,
    "goalThreshold": 5000,
    "percentComplete": 25.6,
    "status": "active"
  }
}
```

If `consentStatus` is anything other than `"approved"`, the client renders
the waiting-for-parent state and disables the "Jag har tränat" button
(backed server-side by endpoint 3's `403`, per above — this is a UX nicety,
not the actual enforcement point).

## Notes for implementers

- **frontend-developer:** endpoints 3 and 4 are intentionally the only two
  calls the home screen ever needs (one on open, one per tap) — don't
  split streak/team-pool into separate fetches, that reintroduces the
  round-trip problem this contract exists to avoid.
- **ux-designer:** the "waiting for parent approval" state (from
  `consentStatus`) needs an actual screen/banner design — it's not an edge
  case, it's the expected state for every player between onboarding and
  parent approval, per ADR-0002 addendum §2's shell/gate split.
- **backend-developer:** endpoint 3's transactional write (Postgres insert
  + streak/pool update, then Redis update) should follow ADR-0002's
  Postgres-then-Redis pattern; the `403 consent_required` check happens
  before that transaction starts, not after.

## Addendum — 2026-07-09: self-service team creation

Per [`docs/adr/0009-self-service-team-creation.md`](../adr/0009-self-service-team-creation.md).
Closes O1's previous dead end: if `inviteCode` doesn't match any team, the
person onboarding can create one instead, becoming its first player and
automatic captain. **Fully additive/backward-compatible** — a client that
never sends `teamName` sees exactly the Phase 1 behavior above, including
the existing `404`. This is a Phase 1 onboarding contract change (not a
Phase 2 one), even though it's landing alongside later phases' work.

### `GET /api/v1/teams/invite/:inviteCode` — unchanged

No new field, no new status code. This endpoint's `404` has exactly one
cause (no team matches the code), so it already unambiguously means "this
code is available" — see ADR-0009 Decision 4. Any "create a new team
instead" affordance off this response is a frontend/UX decision built on
information the client already has, not a backend contract change.

### `POST /api/v1/players` — request gains one optional field

```ts
{
  inviteCode: string;
  screenName: string;
  avatarId: string;
  birthYear: number;
  parentContact: string;
  teamName?: string;       // NEW — set only when the client already knows
                            // (from a prior 404 on the invite-code preview)
                            // that inviteCode doesn't match any team, and
                            // the player has chosen to create one instead
                            // of retrying. Bounded length (see
                            // implementer note below); rejected if it
                            // fails the same content-safety check chat
                            // messages use (ADR-0009 Decision 5).
}
```

Behavior:
- `teamName` **absent** — byte-for-byte today's behavior. `inviteCode` must
  match an existing team or the request `404`s exactly as before.
- `teamName` **present** and `inviteCode` matches an existing team — the
  player simply joins that team; `teamName` is ignored (ADR-0009 Decision 2
  explains why this is a silent no-op rather than a new error).
- `teamName` **present** and `inviteCode` matches no team — a new `Team` is
  created with `inviteCode` as its permanent invite code (ADR-0009
  Decision 3) and `teamName` as its name (subject to the content-safety
  check), together with an active `Season`/`TeamSeasonPot` (ADR-0009
  Decision 6), and this player is created with `isCaptain: true` — the only
  place in the onboarding flow that ever sets it.

### `POST /api/v1/players` — response gains three fields

```json
{
  "playerId": "uuid",
  "teamId": "uuid",
  "teamName": "IBK Falken P13",
  "teamCreated": false,
  "isCaptain": false,
  "screenName": "FloorballStar15",
  "avatarId": "fox",
  "consentStatus": "pending",
  "sessionToken": "eyJ..."
}
```

- `teamName` — the joined-or-created team's actual name. New: the previous
  shape never echoed this back (the join path already showed it at O2's
  preview; the create path has no equivalent preview, so this is the
  client's only server-confirmed copy of the accepted name).
- `teamCreated` — `true` only when this exact request is the one that
  created the team (not merely "this team happens to have been recently
  created by someone else"). Deliberately a separate field from `isCaptain`
  rather than something the client infers from it — see ADR-0009 Decision 2.
- `isCaptain` — `true` if and only if `teamCreated` is `true`, for Phase 1.
  Always present now (previously absent from this response entirely),
  defaulting `false` for the ordinary join path.

### `POST /api/v1/players` — new errors

- **`422 team_name_rejected_by_filter`** — `teamName` was supplied but
  failed the same keyword-based content-safety check used for team chat
  (`ChatModerationCheck`, ADR-0007 Decision 2 / ADR-0009 Decision 5). Only
  reachable when creation was actually attempted (i.e. `inviteCode` didn't
  match an existing team). Client should return the player to the
  team-naming step with a generic, non-judgmental message — exact copy is
  ux-designer's call, same posture as chat's `message_rejected_by_filter`.
- **`409 invite_code_taken_concurrently`** — an extremely rare race: another
  request created a team with the identical `inviteCode` between this
  device's O1 preview and this `POST /players` call. ADR-0009 Decision 8
  explains why this is a hard error rather than a silent fallback-to-join.
  Client should return to O1 ("Screen O1 — Ange lagkod") so the player can
  re-check the code, mirroring the existing "code became invalid between O1
  and now" edge case already documented for the join path.
- Existing `404 invite_code_not_found`, `409 screen_name_taken_in_team`, and
  `400` validation errors are unchanged in meaning; `400` validation now
  also covers `teamName`'s length/non-empty constraints when present.

### Implementer notes

- **backend-developer:** `teamName`, like `screenName`, needs a sane
  `MaxLength` (recommend 60 — no existing cap on `Team.name` today,
  first one being introduced here) validated at the DTO boundary, same
  posture as every other free-text onboarding field. Separately, flagging
  that `inviteCode` itself has **no** `MaxLength` today, even though it may
  now be persisted permanently as a `Team.invite_code` rather than only
  ever compared against existing rows — worth adding a bound (e.g. 30) as
  part of this change, not a pre-existing gap to leave as-is now that the
  field has a new, permanent consequence.
- **ux-designer:** O1's existing `404` copy/flow needs a new branch offering
  "create a new team instead," and — per ADR-0009's flagged risk #4 — a
  real confirmation step before that creation actually happens (this app's
  only other irreversible-ish onboarding action, joining an *existing*
  team, already gets one at O2; creating a brand-new one currently
  wouldn't, without a deliberate design pass to add it). Not designed in
  this contract doc.
- **frontend-developer:** `teamCreated`/`isCaptain` on the `201` response
  are the hook for a distinct "you created your team!" O6-equivalent
  celebration moment, separate from the ordinary "you joined {teamName}"
  copy — exact copy/flow is ux-designer's call, not fixed here.
