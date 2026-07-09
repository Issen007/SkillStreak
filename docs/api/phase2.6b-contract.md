# Phase 2.6b API Contract — Team chat

## Status

Draft for Fas 2.6b build — architect-owned, for backend-developer/
frontend-developer to build against. Same rigor as
`phase1-contract.md`/`phase2-contract.md`: endpoint list + request/response
shapes + the rules that matter, not a full OpenAPI spec.

See [`docs/adr/0007-team-chat.md`](../adr/0007-team-chat.md) first — this
doc assumes its schema/decisions and doesn't re-derive them. **Read that
ADR's Decision 3 before building the report endpoint** — it states plainly
that this feature does not fully close the "who moderates this" gap, and
this contract's rate-limit numbers exist specifically to bound the harm of
that gap, not to solve it.

**security-reviewer sign-off on this contract is a blocking requirement
before merge**, per CLAUDE.md — this is real freeform text between
children with no adult account reachable in-app.

## Conventions

- Base path: `/api/v1` (unchanged).
- One auth universe (unchanged from Phase 2): `Authorization: Bearer
  <playerSessionToken>`, `JwtAuthGuard`, `request.playerId`.
- Every endpoint below requires `request.playerId`'s own `player.teamId ===
  :teamId` (`403 team_mismatch`) — the existing closed-team-bubble rule,
  restated because this is a new domain, not new machinery.
- **No captain gate on any endpoint below** — chat is one shared channel;
  the captain is a participant, not a moderator of it (ADR-0007's Decision
  5). The only asymmetric action anywhere in this contract is
  **sending**, which is gated on parental consent (see endpoint 1), same as
  every other write that generates real behavioral data on a specific
  child.
- Error envelope unchanged:
  ```json
  { "error": { "code": "some_code", "message": "Human-readable, dev-facing" } }
  ```

---

## Endpoints

### 1. `POST /api/v1/teams/:teamId/chat/messages`

Player auth + `team_mismatch` check + **consent gate**
(`parentalConsentStatus === 'approved'`, else `403 consent_required` —
identical check/error to `POST /training-logs`, per ADR-0007's extension of
ADR-0002 addendum §2's reasoning to chat). Runs the moderation check
(ADR-0007 Decision 2) before persisting anything.

Request:
```ts
{ content: string; } // 1-500 chars after trim; empty/whitespace-only rejected
```

Response `201`:
```json
{
  "id": "uuid",
  "teamId": "uuid",
  "senderPlayerId": "uuid",
  "senderScreenName": "FloorballStar15",
  "senderAvatarId": "fox",
  "content": "Bra jobbat idag allihopa! 💪",
  "createdAt": "2026-07-08T18:04:00Z"
}
```

Errors:
- `403 consent_required` — same semantics as `POST /training-logs`.
- `422 message_rejected_by_filter` — the keyword filter blocked this
  content. The message is **not** stored in any form (not redacted, not
  flagged-and-saved) — the sender can edit and resend.
  ```json
  { "error": { "code": "message_rejected_by_filter", "message": "Message contains a disallowed term." } }
  ```
- `429 chat_send_rate_limited` — a per-sender cooldown (exact window
  backend-developer's call; recommend something generous enough for normal
  conversation, e.g. a burst allowance rather than a strict per-message
  gate) to bound spam/flooding, same Redis-cooldown shape as
  `RedisService`'s existing `consentReminderCooldownKey`.
- `400` validation — empty/whitespace-only content, or over the length cap.

### 2. `GET /api/v1/teams/:teamId/chat/messages`

Player auth + `team_mismatch` check only — no consent gate on reading
(consistent with every other team-scoped `GET` in this app).

Query params:
```ts
{
  after?: string;  // ISO timestamp — return messages created after this; omitted = most recent page
  limit?: number;  // default 50, max 200
}
```

Response `200`:
```json
{
  "messages": [
    {
      "id": "uuid",
      "senderPlayerId": "uuid",
      "senderScreenName": "FloorballStar15",
      "senderAvatarId": "fox",
      "content": "Bra jobbat idag allihopa! 💪",
      "createdAt": "2026-07-08T18:04:00Z",
      "reportedByMe": false
    }
  ]
}
```

- Ordered ascending by `createdAt` (chronological — the client appends new
  pages, it doesn't re-sort).
- **Never includes** a message with `status = 'hidden'`, and **never
  includes** a message whose `senderPlayerId` is on the *viewer's own*
  `TeamChatBlock` list — both filters applied server-side in this query,
  not left to the client (ADR-0007 Decision 4/Decision 5).
- `reportedByMe` is `true` only if *this* viewer has already reported *this*
  message — never reveals whether or how many *other* players have
  reported it (ADR-0007 Decision 1's anonymity guarantee).
- No `realName`, no location field, ever — unchanged constraints from every
  other contract in this app.

### 3. `POST /api/v1/teams/:teamId/chat/messages/:messageId/report`

Player auth + `team_mismatch` check only — any player, including the
message's own sender's teammates or the captain, can report any message
(there's no privileged reporter role).

Request:
```ts
{
  reason: 'bullying' | 'inappropriate_language' | 'spam' | 'other';
  note?: string; // max 140 chars, optional
}
```

Response `201`:
```json
{ "reportId": "uuid", "messageId": "uuid", "createdAt": "2026-07-08T18:05:00Z" }
```

Errors:
- `404 chat_message_not_found` — no such message, or it doesn't belong to
  `:teamId`.
- `409 chat_message_already_reported_by_you` — this viewer already
  reported this message (unique per `(messageId, reporterId)`).
- `429 chat_report_rate_limited` — a per-reporter cooldown, bounding
  mass-reporting as a harassment tool in its own right.

**Side effects** (ADR-0007 Decision 3 — read that section before
implementing, not just this shape):
- Persists the `TeamChatMessageReport` row. **Never** changes the
  message's `status` — reporting does not hide anything, for anyone,
  automatically.
- Best-effort emails (never fail the request; log-only on failure, same
  pattern as `ConsentService.sendReminderEmailBestEffort`):
  - to the **reported player's** parent (`parent_contact`), and
  - to the **team's coach**, if `TeamCoach`/`Coach.email` exists for this
    team (dormant schema, reused only for its stored address).
  - Both **rate-limited to at most one email per reported player per
    rolling 24 hours**, aggregating multiple reports in that window —
    deliberately not repeating the Phase 2.5 finding on
    consent-reminder's burst-only cooldown.
- **Never returned to any client**: no endpoint anywhere lists reports, who
  filed them, or how many exist for a message/player — see the ADR's
  Decision 1.

### 4. `POST /api/v1/teams/:teamId/chat/blocks`

Player auth + `team_mismatch` check on both the requester and the target
(`blockedPlayerId` must be a teammate). **Idempotent** — blocking an
already-blocked player returns `200`, not an error.

Request:
```ts
{ blockedPlayerId: string; }
```

Response `200`:
```json
{ "blockedPlayerId": "uuid", "createdAt": "2026-07-08T18:06:00Z" }
```

Errors:
- `400` — `blockedPlayerId` equals the requester's own id.
- `403 team_mismatch` — target not on the same team.
- `404 player_not_found` — no such player.

Silent: the blocked player is never notified, and no response anywhere
reveals who has blocked them.

### 5. `DELETE /api/v1/teams/:teamId/chat/blocks/:blockedPlayerId`

Player auth + `team_mismatch` check. Idempotent unblock — succeeds (`200`)
whether or not a block existed.

Response `200`:
```json
{ "blockedPlayerId": "uuid", "unblocked": true }
```

---

## Notes for implementers

- **backend-developer:** new `backend/src/team-chat/` module. Inject
  `ChatModerationCheck` via a DI token (`CHAT_MODERATION_CHECK`), bound to
  `KeywordChatModerationCheck` for Fas 2.6b — this is the seam
  `docs/BACKLOG.md`'s deferred LLM-moderation item slots into later, per
  ADR-0007 Decision 2. Don't call the keyword-list logic directly from
  `TeamChatService` — go through the interface even though there's only one
  implementation today.
- **backend-developer:** the Swedish wordlist is a plain data file
  (`swedish-filter-wordlist.json`), not a DB table — see ADR-0007 Decision
  2 for why, and for the word-boundary/basic-evasion-resistance
  expectations on the matching logic.
- **backend-developer:** `PlayerPrivateInfoService.getParentContact` gains
  a second legitimate caller (`team-chat/`, for the report-notification
  path) — this is a deliberate, ADR-0007-documented widening of ADR-0002's
  module-boundary rule, not an accidental new dependency; don't add a third
  caller elsewhere without the same explicit treatment.
- **backend-developer:** the message-list query (endpoint 2) must apply the
  `status != 'hidden'` filter and the per-viewer block filter in the same
  query, not as separate post-processing — see ADR-0007 Decision 5's
  reasoning.
- **frontend-developer:** the "report" and "block" actions are two
  different affordances with two different scopes (one message vs. one
  sender, going forward) — don't conflate them in the UI as a single "flag
  this person" action; ux-designer's flow pass should make the distinction
  clear to a child user.
- **frontend-developer:** on `422 message_rejected_by_filter`, keep the
  sender's typed text in the input (don't clear it) so they can edit and
  resend — the backend never stores or returns a "cleaned" version to
  restore instead.
- **ux-designer:** copy for the filter-rejection error, the report reasons,
  and the empty/waiting states (e.g. a team with no messages yet) are not
  fixed here.
- **security-reviewer:** this is a blocking review, per CLAUDE.md. Read
  ADR-0007's Decision 3 in full before signing off — the specific question
  it asks you to weigh is whether "two best-effort, rate-limited emails
  plus a personal block button plus an out-of-band admin hide-switch" is an
  acceptable moderation posture for this beta's current scale. Also confirm:
  the keyword-filter rejection never partially stores content; the
  per-viewer block filter can't be bypassed by any other endpoint (e.g. a
  hypothetical single-message-by-id fetch, which this contract deliberately
  doesn't define, precisely to avoid that bypass; don't add one without
  applying the same filter); rate limits on send/report actually bound
  volume per player, not just per burst.
- **code-critic:** the message-visibility query (status filter + per-viewer
  block filter, endpoint 2) and the report-notification's rate-limit/
  idempotency logic (endpoint 3) are the two places worth the most
  scrutiny — get the "who sees what" query wrong here and it's a real
  child-safety bug, not a cosmetic one.
