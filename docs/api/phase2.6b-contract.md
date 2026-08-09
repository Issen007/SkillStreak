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

**Updated 2026-07-31 per [`docs/adr/0017-chat-clip-attachments.md`](../adr/0017-chat-clip-attachments.md)**:
endpoint 1 gains an optional `clipId` on the request and a nullable `clip`
block on the response; endpoint 2 gains the same nullable `clip` block. Read
that ADR in full before touching either endpoint's clip handling — Decision
1 (why team-scoping here is a write-time loaded-row check *and* a read-time
join predicate, never a composite FK), Decision 2 (why nothing about the
clip is ever snapshotted onto the message row, and why the per-viewer
`TeamChatBlock` filter extends to the embed), and Decision 4 (why `clip_id`
is a plain nullable FK, not a join table or a `kind` discriminator) all
matter here, not just the shapes below. No other endpoint in this contract
changes, and `docs/api/phase3-contract.md` (the clip feed/picker endpoint)
is unchanged — it's reused unmodified as the compose-time picker's data
source (ADR-0017 Decision 3).

**security-reviewer sign-off on this contract is a blocking requirement
before merge**, per CLAUDE.md — this is real freeform text between
children with no adult account reachable in-app.

**Updated 2026-08-06 per [`docs/adr/0021-clip-challenge-notifications.md`](../adr/0021-clip-challenge-notifications.md)**:
team chat's first-ever system-authored message. Every message (both
endpoint 1's send response and endpoint 2's list items) gains two new
fields, `authorType: 'player' | 'system'` and `systemEventType:
'clip_challenge_issued' | null` — see Decision 2 for why this is a real
discriminator, not an overload of the already-nullable `senderPlayerId`.
A `'system'` row is **never** written through endpoint 1 (no DTO field
exposes either new column to a player-facing request) — it's a direct
repository insert from `VideoClipsService.completeUpload`, documented in
`docs/api/phase3-contract.md` endpoint 2's own revision note, not a new
endpoint here. Endpoint 3 (report) gains a new rejection for `'system'`
rows — see that endpoint's own updated section below, this is the ADR's
2026-08-06 security-reviewer addendum's single binding finding. No other
endpoint changes.

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

**Check order** (updated by ADR-0017 Decision 5 — the new clip-resolution
and combined-validation checks are inserted after the existing consent
gate, before the existing moderation check, so an invalid clip reference is
rejected before spending a moderation check on text that would be
discarded anyway):
1. `403 team_mismatch` (unchanged).
2. `403 consent_required` (unchanged).
3. **New** (ADR-0017 Decision 1) — if `clipId` is present, resolve it:
   load the `VideoClip` row and assert `clip.teamId === teamId` **and**
   `clip.status === 'published'`. Either failing is `404 clip_not_found` —
   deliberately the same generic code `docs/api/phase3-contract.md`
   endpoint 2 already uses, merging "no such clip," "wrong team," and "not
   published yet" into one response so this endpoint can't be used as a
   cross-team existence oracle.
4. **New** (ADR-0017 Decision 4) — `400` if `content` is empty/
   whitespace-only **and** `clipId` is absent; or if `content` is over the
   length cap.
5. `422 message_rejected_by_filter` on non-empty `content` (unchanged —
   still only ever runs against `content`; a clip's own `caption` was
   already moderation-checked at upload time, per `docs/api/phase3-contract.md`
   endpoint 1, so it is **not** re-checked here).
6. `429 chat_send_rate_limited` (unchanged — no separate/additional rate
   limit for clip attachment; the existing per-sender chat cooldown is
   judged sufficient).

Request:
```ts
{
  content: string;    // 1-500 chars after trim IF clipId absent;
                       // 0-500 chars if clipId present (ADR-0017 Decision 4)
  clipId?: string;     // must resolve to a published clip on this team
}
```

Response `201`:
```json
{
  "id": "uuid",
  "teamId": "uuid",
  "senderPlayerId": "uuid",
  "senderScreenName": "FloorballStar15",
  "senderAvatarId": "fox",
  "authorType": "player",
  "systemEventType": null,
  "content": "Bra jobbat idag allihopa! 💪",
  "clip": {
    "clipId": "uuid",
    "uploaderPlayerId": "uuid",
    "uploaderScreenName": "ZorroKing09",
    "uploaderAvatarId": "wolf",
    "caption": "Zorro-fint #47!",
    "playbackUrl": "https://minio.internal/clips/...(presigned GET, freshly minted this request)...",
    "createdAt": "2026-07-20T18:07:00Z"
  },
  "createdAt": "2026-07-08T18:04:00Z"
}
```
- `clip` is `null` when no `clipId` was sent. When a `clipId` was sent and
  accepted, `clip` is **always** populated here (it was just validated as
  `published` one query earlier in the same request) — the `null`-on-
  unavailable case only ever arises later, on `GET` (endpoint 2, ADR-0017
  Decision 2).
- **New 2026-08-06 (ADR-0021 Decision 2)**: `authorType` is **always**
  `"player"` and `systemEventType` **always** `null` in this response —
  this endpoint's HTTP path never writes a `'system'` row (no DTO field
  exposes either). Present for shape-parity with endpoint 2's list items,
  not because a system message could ever reach this response.

Errors:
- `403 consent_required` — same semantics as `POST /training-logs`.
- `404 clip_not_found` — **new**, ADR-0017 Decision 1: `clipId` doesn't
  resolve to a `published` clip on this team (no such clip, wrong team, or
  not published yet — deliberately indistinguishable). Identical code/
  semantics to `docs/api/phase3-contract.md` endpoint 2's own
  `clip_not_found`, reused rather than a chat-specific variant.
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
- `400` validation — both `content` empty/whitespace-only **and** `clipId`
  absent (ADR-0017 Decision 4), or `content` over the length cap.

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
      "authorType": "player",
      "systemEventType": null,
      "content": "Bra jobbat idag allihopa! 💪",
      "clip": {
        "clipId": "uuid",
        "uploaderPlayerId": "uuid",
        "uploaderScreenName": "ZorroKing09",
        "uploaderAvatarId": "wolf",
        "caption": "Zorro-fint #47!",
        "playbackUrl": "https://minio.internal/clips/...(presigned GET, freshly minted this request)...",
        "createdAt": "2026-07-20T18:07:00Z"
      },
      "createdAt": "2026-07-08T18:04:00Z",
      "reportedByMe": false
    },
    {
      "id": "uuid",
      "senderPlayerId": null,
      "senderScreenName": null,
      "senderAvatarId": null,
      "authorType": "system",
      "systemEventType": "clip_challenge_issued",
      "content": "🎯 Anna utmanade Karl med en video!",
      "clip": { "...": "same ChatClipEmbed shape as above, resolved live from clipId, same as any other message" },
      "createdAt": "2026-08-01T18:07:00Z",
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
  not left to the client (ADR-0007 Decision 4/Decision 5). A `'system'`
  row's `senderPlayerId` is always `NULL`, so it can never match any
  block's `blocked_player_id` (`NOT NULL`) — structurally un-blockable, no
  new code (ADR-0021 Decision 3).
- `reportedByMe` is `true` only if *this* viewer has already reported *this*
  message — never reveals whether or how many *other* players have
  reported it (ADR-0007 Decision 1's anonymity guarantee). Always `false`
  for a `'system'` row going forward, since reporting one is rejected
  server-side (endpoint 3, updated below) — no `TeamChatMessageReport` row
  can ever exist against one.
- **New 2026-08-06 (ADR-0021 Decision 2)**: `senderPlayerId`/
  `senderScreenName`/`senderAvatarId` are `null` for **two different
  reasons that share the same shape** — an erased player's anonymized
  message (ADR-0013 Decision 6) or a `'system'` row that never had a
  sender at all. `authorType` is what disambiguates the two; a client must
  check it, never infer "erased" from a bare null sender alone. A
  `'system'` row's `content` is a fixed, server-rendered string baked in
  once at publish time (`docs/api/phase3-contract.md` endpoint 2), never
  re-resolved live — it survives either named player's later erasure/rename
  unaffected, same as any ordinary human-authored message's own text.
- **New (ADR-0017 Decision 1/2)**: `clip` is `null` whenever: the message
  never had a `clipId`; the referenced clip is gone (self-deleted or
  expired — `clip_id` now `NULL` on the row, via the FK's `ON DELETE SET
  NULL`); the referenced clip is `hidden`; or the viewer has blocked the
  clip's `uploaderPlayerId` (which may be a different player than the
  message's own `senderPlayerId` — any teammate can attach any team clip).
  The client cannot and should not try to distinguish these — one generic
  "clip unavailable" placeholder, always. Resolved via a `LEFT JOIN` to
  `video_clip` whose join predicate itself encodes `team_id` match,
  `status = 'published'`, and the per-viewer block check — never a bare id
  join followed by an app-level filter (the structural team-scoping
  guarantee ADR-0017 Decision 1 requires). `playbackUrl`, like the feed's
  own, is a fresh presigned GET **minted for this exact response** — never
  cached/reused across requests/polls, same rule as
  `docs/api/phase3-contract.md` endpoint 3.
- No `realName`, no location field, ever — unchanged constraints from every
  other contract in this app.

### 3. `POST /api/v1/teams/:teamId/chat/messages/:messageId/report`

Player auth + `team_mismatch` check only — any player, including the
message's own sender's teammates or the captain, can report any message
(there's no privileged reporter role).

**Unchanged by ADR-0017**: reporting a message that carries a `clip`
attachment behaves identically to reporting any other message — no special
casing (ADR-0017 Decision 6). This endpoint never reports, hides, or
otherwise touches the attached clip's own row; `POST
.../clips/:clipId/report` (`docs/api/phase3-contract.md` endpoint 5) is the
separate, independent way to report the *clip itself*, reachable with the
`clipId` already visible on the message.

**New 2026-08-06 (ADR-0021 Decision 3 / that ADR's own security-reviewer
addendum, finding 1 — binding, checked first, before the already-reported
or rate-limit checks below):** rejects with `400
cannot_report_system_message` when the target message's `authorType ===
'system'`. A system-authored row has no real sender for this mechanism to
ever notify — ADR-0007 Decision 3's entire report mechanism exists to
email **a real reported player's** parent/coach, which a `'system'` row
structurally can never have. Accepting the report anyway would create a
`TeamChatMessageReport` with a reporter and no meaningful target, which is
worse than not accepting it.

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
- `400 cannot_report_system_message` — **new 2026-08-06**, see above.
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

**Extended by ADR-0017 Decision 2**: a block also suppresses that player's
clip attachments as they appear *embedded in chat* — if the viewer has
blocked a teammate, any message referencing that teammate's clip renders
`clip: null` for the viewer, even though the message text itself (sent by
someone else) still shows. This reuses the exact same `TeamChatBlock`
row/endpoint; no new block type or endpoint is introduced.

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
- **backend-developer (ADR-0017):** the clip embed's team/status/block
  visibility must be enforced by the `LEFT JOIN`'s own predicate, not a
  bare `id` join plus an app-level filter afterward — this is the
  structural, "can't be forgotten in a future refactor" guarantee ADR-0017
  Decision 1 requires, mirroring ADR-0008's "the table is never joined"
  bar. Never snapshot any clip field (caption, uploader, thumbnail) onto
  `TeamChatMessage` or into a cached response — everything about the
  attached clip is resolved live, every request (Decision 2); a snapshot
  would let a report-hidden clip's own flagged caption keep rendering
  inside chat, defeating the auto-hide-on-report protection
  `docs/api/phase3-contract.md` already built for the feed.
- **backend-developer (ADR-0017):** `team-chat/`'s dependency on
  `video-clips/`'s `VideoClip` entity is new, one-directional, and
  read-only — don't add a reverse dependency, and don't add a bare
  `videoClipRepository.findOne({ id })` anywhere without the
  `teamId`/`status` conditions alongside it (Decision 1).
- **frontend-developer:** the "report" and "block" actions are two
  different affordances with two different scopes (one message vs. one
  sender, going forward) — don't conflate them in the UI as a single "flag
  this person" action; ux-designer's flow pass should make the distinction
  clear to a child user.
- **frontend-developer:** on `422 message_rejected_by_filter`, keep the
  sender's typed text in the input (don't clear it) so they can edit and
  resend — the backend never stores or returns a "cleaned" version to
  restore instead.
- **frontend-developer (ADR-0017):** the compose-time clip picker calls the
  existing `GET /api/v1/teams/:teamId/clips` (`docs/api/phase3-contract.md`
  endpoint 3) exactly as the Shorts feed screen already does — there is no
  new picker endpoint. On `404 clip_not_found` from `POST .../chat/messages`
  (e.g. the picker's list went stale and the clip was deleted/hidden in the
  meantime), treat it the same as any other send failure — don't try to
  distinguish it from "clip never existed."
- **ux-designer:** copy for the filter-rejection error, the report reasons,
  and the empty/waiting states (e.g. a team with no messages yet) are not
  fixed here.
- **ux-designer (ADR-0017):** the compose-time clip picker, the in-message
  clip-embed rendering, and the generic "clip unavailable" placeholder copy
  are not fixed here either — see that ADR's hand-off section.
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
- **security-reviewer (ADR-0017):** per that ADR's hand-off, a confirmation
  pass is warranted on exactly two things before merge — (1) the clip-embed
  join predicate actually closes the cross-team boundary (no path exists to
  construct or render a cross-team reference), and (2) no cached
  caption/thumbnail/uploader-name field was quietly reintroduced on
  `TeamChatMessage` or in any response, which would reopen the leak
  Decision 2 argues against.
- **code-critic:** the message-visibility query (status filter + per-viewer
  block filter, endpoint 2) and the report-notification's rate-limit/
  idempotency logic (endpoint 3) are the two places worth the most
  scrutiny — get the "who sees what" query wrong here and it's a real
  child-safety bug, not a cosmetic one. **ADR-0017:** the same scrutiny now
  also applies to the clip-embed join predicate (endpoint 2) and the
  clip-resolution/combined-validation checks (endpoint 1) — a mis-scoped
  join or a `clipId` accepted without the `teamId`/`status` conditions
  would be an identical class of bug.
- **backend-developer (2026-08-06, ADR-0021):** the `authorType ===
  'system'` guard on endpoint 3 (`reportMessage`) is checked immediately
  after loading the target message, before the already-reported/cooldown
  checks — a structural rejection, not a stale-state one. Has its own test
  asserting the rejection (`team-chat.service.spec.ts` and the e2e suite),
  per the ADR's own binding instruction — this is not optional.
- **security-reviewer (2026-08-06, ADR-0021):** the scoped confirmation
  pass this revision is built against is recorded in that ADR's own Status
  section addendum — its three "verify directly" claims (`authorType`/
  `systemEventType` unreachable from any player-facing DTO; `content` for a
  system row is fixed-template-only in the real implementation; block is
  structurally inert against a system row by construction) all held as
  designed against the actual code, per that addendum.
