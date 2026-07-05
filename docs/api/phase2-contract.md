# Phase 2 API Contract — coach dashboard, challenges, session reissue

## Status

Draft for Phase 2 build — architect-owned, for backend-developer/
frontend-developer to build against. Same rigor as
`docs/api/phase1-contract.md`: endpoint list + request/response shapes +
the sequencing/state-machine rules that matter, not a full OpenAPI spec.
Formalizes the informal sketches in `docs/design/phase2-flows.md`'s
"Notes for architect/backend-developer" section, and the two auth
decisions in `docs/adr/0004-coach-auth-and-session-reissue.md` (read that
ADR first — this doc assumes its schema/guard decisions).

Builds on `phase1-contract.md`, doesn't replace it — Phase 1's four
endpoints (`GET /teams/invite/:inviteCode`, `POST /players`,
`POST /training-logs`, `GET /players/me`) are unchanged except where noted
below (`POST /training-logs`'s `challengeId` validation).

## Conventions

- Base path: `/api/v1` (unchanged).
- **Two independent auth universes, per ADR-0004 — never mixed:**
  - **Player routes** (existing + new player-facing ones below):
    `Authorization: Bearer <playerSessionToken>`, verified by the existing
    `JwtAuthGuard` against `JWT_SECRET`, now also checking
    `Player.token_version` (ADR-0004 Part 3). Populates `request.playerId`.
  - **Coach routes** (everything under `/api/v1/coach/*`):
    `Authorization: Bearer <coachSessionToken>`, verified by the new
    `CoachAuthGuard` against `COACH_JWT_SECRET`. Populates
    `request.coachId`. A player token on a coach route (or vice versa)
    fails signature verification outright — there is no shared secret to
    accidentally satisfy both.
  - Any endpoint under `/api/v1/coach/teams/:teamId/...` or that otherwise
    scopes to a team additionally runs `CoachTeamAccessGuard`, which
    confirms a `TeamCoach` row exists for `(request.coachId, teamId)` —
    `403 team_access_forbidden` otherwise. Endpoints scoped by a resource
    id instead of a team id directly (e.g. a challenge id) do the
    equivalent check in the service layer (look up the resource's
    `teamId`, then check `TeamCoach`) rather than in a route-level guard.
- Error envelope unchanged from Phase 1:
  ```json
  { "error": { "code": "some_code", "message": "Human-readable, dev-facing" } }
  ```
- "Day"/date rules (Europe/Stockholm, server-computed) and the
  no-location-field rule carry over unchanged from Phase 1's conventions.
- Coach-facing response shapes never include `real_name` (still isolated in
  `PlayerPrivateInfo`, per ADR-0002's addendum) or `parent_contact` — a
  coach dashboard has no legitimate need for either, and `phase2-flows.md`
  deliberately designs every coach screen around `screenName`.

## Endpoints

### Coach authentication (ADR-0004 Part 1)

#### 1. `POST /api/v1/coach/auth/login`

No auth (a coach doesn't have a session yet).

Request:
```ts
{ email: string; password: string }
```

Response `200`:
```json
{ "coachId": "uuid", "displayName": "Coach Anna", "sessionToken": "eyJ..." }
```

Error `401 invalid_credentials` — deliberately identical for "no such
email" and "wrong password":
```json
{ "error": { "code": "invalid_credentials", "message": "..." } }
```

Rate-limited (`@Throttle`, same convention as `ConsentController`) —
credential-stuffing surface, not just a formality.

#### 2. `POST /api/v1/coach/auth/password-reset/request`

No auth.

Request: `{ email: string }`

Response `200` always, regardless of match (no account-enumeration tell):
```json
{ "message": "If an account exists for this email, a reset link was sent." }
```

Side effect (only if `email` matches a `Coach`): generates a reset token
(same shape as `consent-token.util.ts`'s generator, a sibling utility, not
literal reuse — see ADR-0004), stores it on `Coach`, emails a reset link via
the existing `MailService`.

#### 3. `POST /api/v1/coach/auth/password-reset/confirm`

No auth (the token in the body is the credential, same posture as the
consent-approval endpoint).

Request: `{ token: string; newPassword: string }`

Response `200`: `{ "message": "Password updated. Log in with your new password." }`

Errors: `400 invalid_or_expired_token` (generic — doesn't distinguish
expired vs. already-used vs. never-existed), `400` validation on
`newPassword` (minimum length — exact policy is backend-developer's
implementation call, not fixed here).

---

### Coach dashboard & roster

#### 4. `GET /api/v1/coach/teams/:teamId/dashboard`

Coach auth + `CoachTeamAccessGuard`. One call for Screen C1, per Phase 1's
"no extra round-trip" principle.

Response `200`:
```json
{
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
  "challenges": {
    "activeCount": 2,
    "draftCount": 1,
    "completedCount": 4,
    "recent": [
      {
        "id": "uuid",
        "title": "Zorro-finter-utmaningen",
        "status": "active",
        "endDate": "2026-07-11",
        "completedCount": 5,
        "rosterCount": 16
      }
    ]
  }
}
```

`challenges.recent` is capped at 3 entries (active first, then draft, then
most-recently-completed), matching C1's layout — the full list lives at
endpoint 7 below (`GET /api/v1/coach/teams/:teamId/challenges`), not a
separate shape here.

#### 5. `GET /api/v1/coach/teams/:teamId/roster`

Coach auth + `CoachTeamAccessGuard`. Backs Screen C2.

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

`lastTrainedDate` is `null` if the player has never logged. No `realName`,
no `parentContact` — see Conventions above.

#### 6. `POST /api/v1/coach/players/:playerId/consent-reminder`

Coach auth; the service resolves `playerId → teamId` and checks
`CoachTeamAccessGuard`'s underlying membership rule (service-layer check,
per Conventions, since the guard itself is path-param-`teamId`-shaped).
Backs C2's **"Skicka påminnelse till förälder"** action — a genuinely new
endpoint, per `phase2-flows.md`'s judgment call (the Phase 1 consent flow
only ever issued one token at account-creation time).

Request: none (empty body).

Response `200`:
```json
{ "message": "Reminder sent.", "sentAt": "2026-07-05T10:00:00Z" }
```

Behavior: only valid while `parentalConsentStatus = pending` —
`409 consent_not_pending` otherwise (e.g. already approved, or revoked —
re-sending a reminder for either doesn't make sense and shouldn't be a
silent no-op that leaves the coach unsure if it worked). Re-uses the
existing `consent_token`/`consent_token_expires_at` columns on `Player`:
generates a fresh token (invalidating any prior unused one, same
single-use posture as today) and re-sends the same consent-request email
template. Rate-limited per player (e.g. one reminder per 5 minutes) to
stop a coach mashing the button from spamming a parent's inbox — exact
window is backend-developer's call, not fixed here, but the need for
*some* limit is not optional given this sends real email to a real parent.

#### 7. `POST /api/v1/coach/players/:playerId/session-reissue`

Coach auth; same `playerId → teamId` service-layer membership check as
endpoint 6. Backs C2's **"Skicka ny inloggningslänk"** action. Full flow
in ADR-0004 Part 3 — this is just the shape.

Request: none.

Response `200`:
```json
{ "reissueCode": "H4K7QWXP", "expiresAt": "2026-07-05T10:15:00Z" }
```

Side effects (one transaction): increments `player.token_version`
(invalidating every existing token for this player immediately),
generates+stores a fresh `session_reissue_code`/`_expires_at` (15-minute
TTL, overwriting any prior unredeemed code). The frontend must render
`reissueCode` prominently on the confirmation screen — see ADR-0004's note
that `phase2-flows.md`'s existing confirmation copy ("Ny länk skickad...")
needs a small adjustment since this is a *displayed code*, not something
sent through a channel the kid checks separately.

---

### Challenge CRUD

State machine (enforced server-side, not just a UI convention):
`draft → active → completed | cancelled`. No other transition is legal —
no `active → draft`, no un-cancelling (`cancelled` is terminal), no
skipping straight to `completed` (that's presumably a scheduled/automatic
transition once `endDate` passes, not a coach action — see note on
endpoint 9). `targetMetric`, `targetValue`, `startDate`, `endDate` are
frozen the moment `status` leaves `draft`; only `draft` challenges accept
`PATCH` changes to those fields.

#### 8. `POST /api/v1/coach/teams/:teamId/challenges`

Coach auth + `CoachTeamAccessGuard`. Backs Screen CB4's "Spara som utkast"
/ "Publicera nu" — a single endpoint, `status` in the body decides which.

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

Response `201`: the full `Challenge` row (camelCase field names matching
the entity — `id`, `teamId`, `createdByCoachId`, `title`, `description`,
`targetMetric`, `targetValue`, `startDate`, `endDate`, `status`).

Errors: `400` validation (`targetMetric` not in the fixed enum —
per `phase2-flows.md`'s CB2 judgment call, this is enforced at the DTO
boundary exactly like `BadgeAwardContext`'s discriminated union in
ADR-0002's addendum, not left to the free-form column type; `endDate` ≤
`startDate`; `status` anything other than `draft`/`active` at creation).

#### 9. `PATCH /api/v1/coach/challenges/:id`

Coach auth; service-layer `teamId` membership check (challenge's `teamId`
against the coach's `TeamCoach` rows).

Request (all fields optional; only the fields being changed):
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

Rules, enforced in the service layer, not trusted from the client:
- If the current row's `status !== 'draft'`: any attempt to change
  `targetMetric`, `targetValue`, `startDate`, or `endDate` is rejected —
  `409 challenge_target_frozen` — even if the new values are identical to
  the old ones (simplest rule to reason about; a no-op edit isn't worth a
  special case). `title`/`description` may still be edited at any
  non-terminal status (cosmetic, no fairness concern).
- `status` transitions accepted: `draft → active`, `active → completed`,
  `active → cancelled`. Anything else (`draft → completed`,
  `draft → cancelled`, `completed → *`, `cancelled → *`, or setting the
  same status) is `409 invalid_challenge_transition`.
- `active → completed` is modeled here as *available* (a coach or a future
  scheduled job marking a challenge done once `endDate` passes) but this
  contract doesn't mandate who/what calls it — backend-developer may add
  an automatic end-of-day sweep once `endDate` passes as a follow-up; doing
  it manually via this endpoint is sufficient for Phase 2.

Response `200`: the updated `Challenge` row, same shape as endpoint 8.

#### 10. `GET /api/v1/coach/teams/:teamId/challenges`

Coach auth + `CoachTeamAccessGuard`. Backs C1's "Visa alla" and C3's list
view (no separate screen/shape — same endpoint, no query param needed for
Phase 2's scale; add pagination later if a team ever has enough challenges
to need it).

Response `200`: `{ "challenges": [ /* Challenge rows, newest first */ ] }`

#### 11. `GET /api/v1/coach/challenges/:id`

Coach auth; service-layer `teamId` membership check. Backs Screen C3.

Response `200`:
```json
{
  "challenge": { /* full Challenge row */ },
  "completion": { "completedCount": 5, "rosterCount": 16 }
}
```

`completion` is the same aggregate computation as the player-facing
endpoint 12 below — reused, not duplicated (see that endpoint's note).
No per-player ranked list, per `phase2-flows.md`'s explicit "no leaderboard
here either" judgment call.

---

### Player-facing challenge endpoints

#### 12. `GET /api/v1/players/me/challenges`

Player auth (`JwtAuthGuard`). Backs Screen CP1.

Response `200`:
```json
{
  "active": [
    {
      "id": "uuid",
      "title": "Zorro-finter-utmaningen",
      "description": "Gör så många zorro-finter du kan innan fredag!",
      "targetMetric": "drill-minuter",
      "targetValue": 90,
      "endDate": "2026-07-11",
      "playerProgress": 42,
      "playerComplete": false,
      "completedCount": 5,
      "rosterCount": 16
    }
  ],
  "completed": [
    { "...": "same shape, playerComplete reflects final state" }
  ]
}
```

`playerProgress` = sum of this player's own
`TrainingLogEntry.durationMinutes` where `challengeId` matches, filtered
to log rows whose `activityType` matches the challenge's `targetMetric`
unless the metric is `total-minuter` (which sums across all
`activityType`s) — computed server-side, not trusted from any client
state. `completedCount`/`rosterCount` is the same team-wide aggregate
computation backing coach endpoint 11 (one shared service method,
consumed by both the coach and player controllers, per the note in
`phase2-flows.md`'s sketch — avoids two slightly-different
implementations of "how many players hit the target" drifting apart).

No pagination, no infinite scroll — matches the UX doc's "a team has a
handful of challenges at a time."

---

### `POST /api/v1/training-logs` — `challengeId` validation (extends Phase 1)

Shape unchanged from `phase1-contract.md` (still
`{ activityType, durationMinutes, challengeId? }` →
`{ trainingLogId, loggedAt, streak, teamPool }`). What changes in Phase 2:
a submitted `challengeId` is now actually validated, where Phase 1 accepted
and stored it uninspected. Three checks, in order, each with its own error
so the client (and code-critic) can tell them apart:

1. **Challenge exists and belongs to the player's own team** —
   `404 challenge_not_found` otherwise (deliberately the same code whether
   the id doesn't exist at all or belongs to a different team — never
   confirm cross-team existence, per the closed-team-bubble constraint;
   this is the same "don't hint" posture as `invite_code_not_found`).
2. **Challenge is `active`** — `409 challenge_not_active` for `draft`,
   `completed`, or `cancelled` (a client showing a stale cached chip from
   before a challenge ended is the realistic trigger, not malice).
3. **Metric-compatible with the submitted `activityType`** — the
   challenge's `targetMetric` must be `total-minuter` or match the
   activity type (`fitness-minuter` ↔ `fitness`, etc.) —
   `400 challenge_metric_mismatch` otherwise. This is the "reject
   silently-mismatched tags" rule `phase2-flows.md`'s notes call out
   explicitly: a client bug or a stale UI state must not be allowed to
   tag, say, a `running` log to a `drill-minuter` challenge and have it
   silently count.

All three checks happen inside the same pre-transaction/in-transaction
structure `TrainingLogsService.logTraining` already uses for the consent
check (validate before the row-locked re-read, re-validate against the
locked data if there's any race-relevant state — here, a challenge going
`cancelled` mid-request is the analogous race to consent being revoked
mid-request in Phase 1, and should be re-checked after acquiring whatever
lock is taken, not just before).

## Notes for implementers

- **backend-developer:** `CoachTeamAccessGuard` and the service-layer
  "resolve resource → teamId → check TeamCoach" pattern (endpoints 6, 7, 9,
  11) are the same authorization primitive expressed two ways — factor the
  actual membership check into one shared method both call, don't
  reimplement the `TeamCoach` lookup per endpoint.
- **backend-developer:** the shared "team-wide completion aggregate" used
  by endpoints 11 and 12 should be one service method, not two — see that
  note inline above.
- **frontend-developer:** the new player-facing "enter your reissue code"
  screen (ADR-0004 Part 3, step 4) has no Phase 1 equivalent to build
  from — treat it as a new small flow, not a variant of an existing
  screen.
- **ux-designer:** the C2 "Skicka ny inloggningslänk" confirmation copy
  needs to actually surface `reissueCode` from endpoint 7's response, not
  just a generic "sent" toast — flagged in ADR-0004, repeated here since
  it's this contract's response shape that makes the gap concrete.
- **security-reviewer:** per CLAUDE.md, this whole contract touches auth
  (coach login, password reset, session reissue) and child data (roster,
  consent reminder) — blocking review before merge, not a final check.
  Specifically worth confirming: the reissue-code entropy/TTL/throttle
  combination (ADR-0004), the consent-reminder rate limit (endpoint 6),
  and that no coach endpoint response leaks `realName`/`parentContact`.
