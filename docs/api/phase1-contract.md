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
  backend-developer seed/admin step.
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
   practice) — no endpoint needed for this in Phase 1.
2. App calls `GET /teams/invite/:inviteCode` to preview the team
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

Preview a team before joining. No auth (a device doesn't have a token
yet at this point).

Response `200`:
```json
{ "teamId": "uuid", "teamName": "IBK Falken P13" }
```

Response `404` (unknown/invalid code) — deliberately generic, doesn't
hint whether a code is "close" to valid:
```json
{ "error": { "code": "invite_code_not_found", "message": "..." } }
```

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
