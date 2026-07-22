# Phase 3 API Contract — Video clips & the team feed

## Status

Draft for Fas 3 build — architect-owned, for backend-developer/
frontend-developer/ux-designer to build against. Same rigor as
`phase1-contract.md`/`phase2.6b-contract.md`: endpoint list + request/
response shapes + the rules that matter, not a full OpenAPI spec.

See [`docs/adr/0010-video-storage-and-serving.md`](../adr/0010-video-storage-and-serving.md)
first — this doc assumes its decisions (MinIO/S3-API storage, structural
team-scoping, auto-hide-on-report, retention) and doesn't re-derive them.

**security-reviewer sign-off on this contract is a blocking requirement
before backend-developer builds against it**, per CLAUDE.md and
`docs/ACTION_PLAN.md`'s explicit Phase 3 sequencing — this is real video of
real children.

**Revised 2026-07-22**: endpoint 2 (`complete`) and the implementer notes
below were updated to close two required findings from security-reviewer's
first pass (mandatory location-metadata stripping; a TTL/sweep for
abandoned `pending_upload` rows) — see
[`docs/adr/0010-video-storage-and-serving.md`](../adr/0010-video-storage-and-serving.md)'s
own revision note for the full reasoning. Re-requesting sign-off against
this version.

## Conventions

- Base path: `/api/v1` (unchanged).
- One auth universe (unchanged): `Authorization: Bearer <playerSessionToken>`,
  `JwtAuthGuard`, `request.playerId`.
- Every endpoint below requires `request.playerId`'s own `player.teamId ===
  :teamId` (`403 team_mismatch`) — restated per new domain, not new
  machinery, same as every prior phase's contract.
- **Consent gate applies to both writing *and* reading**, a deliberate
  divergence from `phase2.6b-contract.md`'s chat convention (chat-read is
  ungated there). Video is a materially more sensitive data category than
  text or a training-log entry — until a parent has approved
  (`parentalConsentStatus === 'approved'`), the client shows the existing
  "waiting for parent approval" state instead of the feed at all, not just
  a disabled upload button. Every endpoint below, including the `GET` feed
  fetch, returns `403 consent_required` (identical shape/semantics to
  `POST /training-logs`) if the requesting player's own consent isn't
  `approved` yet.
- Error envelope unchanged:
  ```json
  { "error": { "code": "some_code", "message": "Human-readable, dev-facing" } }
  ```
- No endpoint here accepts or returns any location/geo field, same
  standing rule as every prior contract.

---

## Endpoints

### 1. `POST /api/v1/teams/:teamId/clips/upload-url`

Step 1 of the two-phase upload (ADR-0010 Decision 1/2). Player auth +
`team_mismatch` check + **consent gate** (`403 consent_required`, same
semantics as `POST /training-logs`) + a per-player upload-frequency rate
limit (Redis cooldown, same shape as existing consent-reminder/chat-send
cooldowns — exact number backend-developer's call, recommend something
generous like a handful per day, this is a slow, deliberate action, not
chat).

Request:
```ts
{
  mimeType: 'video/mp4' | 'video/quicktime' | 'video/webm';
  fileSizeBytes: number;      // client-declared; hard-capped, e.g. 25_000_000
  durationSeconds: number;    // client-declared; hard-capped, e.g. 20
  caption?: string;           // max 140 chars; run through ChatModerationCheck
  taggedPlayerId?: string;    // must be a teammate — "tag to challenge" (ADR-0010 Decision 3)
}
```

Response `201`:
```json
{
  "clipId": "uuid",
  "uploadUrl": "https://minio.internal/clips/...(presigned PUT)...",
  "uploadMethod": "PUT",
  "requiredHeaders": { "Content-Type": "video/mp4" },
  "expiresAt": "2026-07-22T18:10:00Z"
}
```

Server creates a `VideoClip` row (`status: 'pending_upload'`), generates a
**server-chosen** `storage_key` (`clips/{teamId}/{clipId}.<ext>` — never
client-supplied, per ADR-0010 Decision 1), and returns a short-lived (~5
min) presigned PUT scoped to exactly that key. A row left in
`pending_upload` (never `complete`d) is automatically cleaned up ~1 hour
later by the retention sweep's `pending_upload` TTL (ADR-0010 Decision 5)
— not something the client needs to handle, but worth knowing a `clipId`
from this response isn't valid forever if `complete` is never called.

Errors:
- `403 consent_required`.
- `400` validation — `mimeType` not in the allow-list, `fileSizeBytes`/
  `durationSeconds` over the hard cap, `caption` over length, `taggedPlayerId`
  not a teammate.
- `422 caption_rejected_by_filter` — same `ChatModerationCheck` used for
  chat/team-name, applied to `caption`.
- `429 clip_upload_rate_limited`.

### 2. `POST /api/v1/teams/:teamId/clips/:clipId/complete`

Step 2 — client calls this after successfully `PUT`-ing bytes to the
presigned URL from endpoint 1. Player auth + `team_mismatch` + must be the
clip's own `uploaderPlayerId` + clip must currently be `pending_upload`.

Request: none (empty body).

Server does the following before this clip can ever become `published`
(ADR-0010 Decision 3 — no deep content inspection, no ML; steps 1-2 are
mandatory, step 3 is optional/backend-developer's call):

1. A `HEAD` against the object in MinIO to confirm it actually arrived and
   its real size/content-type are consistent with what was declared at
   step 1 ("technical validity").
2. **A metadata-stripping remux** (`ffmpeg -map_metadata -1 -c copy` or
   equivalent) that overwrites the object at the same `storage_key` with a
   version stripped of all container/stream metadata — **this is where
   embedded GPS/location data that phone cameras write by default gets
   removed, before the clip is ever reachable via any playback URL.** This
   is **not optional and not skippable** — see ADR-0010 Decision 3. If this
   step fails for any reason, `complete` fails with `422
   clip_processing_failed` rather than publishing an unprocessed file.
3. (Non-blocking, backend-developer's call) the same tool can cheaply
   report the object's actual duration as an extra integrity signal against
   the client-declared `durationSeconds`.

Only after steps 1-2 succeed does the server set `status: 'published'`,
`expiresAt = now() + retentionWindow` (ADR-0010 Decision 5).

Response `200`:
```json
{
  "clipId": "uuid",
  "status": "published",
  "playbackUrl": "https://minio.internal/clips/...(presigned GET, short-lived)...",
  "caption": "Zorro-fint #47!",
  "taggedPlayerId": "uuid",
  "createdAt": "2026-07-22T18:07:00Z",
  "expiresAt": "2026-10-20T18:07:00Z"
}
```

Errors:
- `404 clip_not_found` — no such `clipId` for this uploader/team, or it's
  not in `pending_upload` state (already completed, or never created).
- `409 upload_not_found` — the object never actually landed in MinIO within
  the presigned window (the `HEAD` check failed). Client should retry from
  endpoint 1 (a fresh `clipId`/upload URL), not retry `complete` again for
  the same one.
- `422 clip_processing_failed` — the object arrived, but the mandatory
  metadata-stripping remux (step 2 above) failed. The clip stays
  `pending_upload` (not published, not silently published-unstripped);
  client should treat this like `upload_not_found` and retry from endpoint
  1 with a fresh upload — a clip that failed to strip is never a clip
  that's allowed to publish anyway.

### 3. `GET /api/v1/teams/:teamId/clips`

The team feed. Player auth + `team_mismatch` + **consent gate** (see
Conventions above — this is the divergence from chat's ungated reads).

Query params:
```ts
{
  before?: string;  // ISO timestamp — pagination cursor, most-recent-first
  limit?: number;   // default 20, max 50
}
```

Response `200`:
```json
{
  "clips": [
    {
      "clipId": "uuid",
      "uploaderPlayerId": "uuid",
      "uploaderScreenName": "FloorballStar15",
      "uploaderAvatarId": "fox",
      "taggedPlayerId": "uuid",
      "taggedScreenName": "ZorroKing09",
      "caption": "Zorro-fint #47!",
      "playbackUrl": "https://minio.internal/clips/...(presigned GET, freshly minted this request)...",
      "createdAt": "2026-07-22T18:07:00Z",
      "reportedByMe": false
    }
  ]
}
```

- Ordered descending by `createdAt` (most recent first — a feed, not a
  chronological log).
- **Never includes** a clip with `status = 'hidden'` or `'pending_upload'`
  — only `published` clips ever appear, and the `hidden` filter is applied
  in this same query, not as client-side post-processing (identical
  reasoning to `phase2.6b-contract.md` endpoint 2's message-visibility
  query).
- **Also excludes any clip whose `uploaderPlayerId` the requesting viewer
  has blocked via an existing `TeamChatBlock`** — per
  `docs/design/phase3-flows.md`'s "does blocking a teammate in chat also
  hide their clips?" decision, a block is a single per-viewer preference
  spanning both chat and clips, not two independent settings. Filtered on
  `uploaderPlayerId`, not `taggedPlayerId` (a blocked player's own uploads
  never show; being tagged by them in someone *else's* clip still does),
  and applied in this same query alongside the `status` filter, not as a
  second, separate pass.
- `playbackUrl` is a **fresh presigned GET minted for this exact response**
  — never cached/reused from `complete`'s response, never valid indefinitely
  (ADR-0010 Decision 2).
- `taggedPlayerId`/`taggedScreenName` are `null` when no teammate was
  tagged.
- `reportedByMe` — same anonymity guarantee as chat's identically-named
  field: `true` only if *this* viewer reported *this* clip, never reveals
  others' reports.
- No `realName`, no location field, ever.

### 4. `DELETE /api/v1/teams/:teamId/clips/:clipId`

Self-service delete. Player auth + `team_mismatch` + must be the clip's own
`uploaderPlayerId` (`403 not_your_clip` otherwise — no captain/coach
override, per ADR-0010 Decision 5). No consent gate (removing your own
content is always allowed, same posture as every other player-authority
action in this app).

Response `200`:
```json
{ "clipId": "uuid", "deleted": true }
```

Hard-deletes the object from MinIO and the `VideoClip` row, immediately,
unconditionally — even if the clip currently has open `ClipReport` rows
(which survive independently, per ADR-0010's `ON DELETE SET NULL` +
denormalized-uploader design).

Errors:
- `404 clip_not_found`.
- `403 not_your_clip`.

### 5. `POST /api/v1/teams/:teamId/clips/:clipId/report`

Player auth + `team_mismatch` + **consent gate** (reporting is itself a
write; matches this contract's stricter posture) + clip must be
`published`. Any teammate, including the uploader's own tagged challenger,
can report.

Request:
```ts
{
  reason: 'appears_without_consent' | 'inappropriate_content' | 'not_training_related' | 'bullying' | 'other';
  note?: string; // max 140 chars, optional
}
```

Response `201`:
```json
{ "reportId": "uuid", "clipId": "uuid", "createdAt": "2026-07-22T18:09:00Z" }
```

Errors:
- `404 clip_not_found`.
- `409 clip_already_reported_by_you` — unique per `(clipId, reporterId)`.
- `429 clip_report_rate_limited`.

**Side effects (ADR-0010 Decision 4 — read that section before
implementing, not just this shape):**
- **Immediately sets `VideoClip.status = 'hidden'`** — the clip disappears
  from every teammate's feed on their next fetch, including the uploader's
  own. This is the deliberate divergence from chat's report behavior; don't
  copy `phase2.6b-contract.md` endpoint 3's "never changes visibility" rule
  here, it's intentionally different for video.
- Persists the `ClipReport` row, denormalizing `reportedUploaderPlayerId`
  at write time (survives the clip's own eventual deletion).
- Best-effort, rate-limited emails (never fail the request; log-only on
  failure) to the **uploader's own parent** and the **team's coach if on
  file**, both capped at one email per uploader per rolling 24 hours,
  identical mechanism to `phase2.6b-contract.md` endpoint 3.
- **Never returned to any client** — no endpoint lists reports, reporters,
  or counts, same anonymity guarantee as chat.
- **No in-app un-hide** — a hidden clip can only become visible again via
  the same out-of-band admin action ADR-0007 already established for chat
  (a backend-developer script/manual DB action). There is no endpoint in
  this contract for it, deliberately.

---

## Notes for implementers

- **backend-developer:** new `backend/src/video-clips/` module. Needs a
  MinIO/S3 client (recommend the standard `@aws-sdk/client-s3` +
  `@aws-sdk/s3-request-presigner` — it's the S3 API regardless of which
  server implements it) and new `k8s/` manifests for the MinIO
  Deployment/PVC/Service (see ADR-0010 Consequences) — not written here.
- **backend-developer:** `PlayerPrivateInfoService.getParentContact` gains
  a **third** legitimate caller (`video-clips/`, for the report-notification
  path) — a deliberate, ADR-0010-documented widening, same posture as
  ADR-0007's own addition of a second caller. Don't add a fourth elsewhere
  without the same explicit treatment.
- **backend-developer:** the feed query (endpoint 3) must exclude
  `status != 'published'` in the same query that does the team-scoping
  join — not as a separate filter step — mirroring
  `phase2.6b-contract.md`'s instruction for the chat message-list query.
- **backend-developer:** the daily retention sweep (ADR-0010 Decision 5) is
  a new scheduled task, not an endpoint in this contract — implement with
  `@nestjs/schedule`, delete the MinIO object before the Postgres row (see
  ADR-0010 for the failure-mode reasoning on that ordering).
- **backend-developer:** a **second, more frequent** scheduled task (recommend
  hourly) sweeps `pending_upload` rows past their ~1 hour TTL (ADR-0010
  Decision 5) — deletes the underlying object if one exists, then the row.
  Can share implementation with the daily retention sweep (same mechanism,
  parameterized by status/TTL), not a second separate piece of
  infrastructure. This is required before launch, not a nice-to-have — it's
  the fix for an otherwise-unbounded storage-exhaustion path on the
  single-replica MinIO pod.
- **backend-developer:** endpoint 2 (`complete`)'s metadata-stripping remux
  is **mandatory, not optional** — don't ship a version of `complete` that
  sets `status: 'published'` without it having run successfully first. This
  is the fix for a real no-location-tracking violation (phone cameras embed
  GPS in video containers by default), not a nice-to-have hardening pass;
  see ADR-0010 Decision 3 for the exact `ffmpeg` invocation and the
  reasoning for why a remux doesn't conflict with this ADR's "no deep
  re-encoding" scope.
- **backend-developer:** configure the MinIO bucket/policy with a max
  object size matching the declared `fileSizeBytes` cap (ADR-0010 Decision
  1) — a presigned PUT can't enforce `Content-Length` server-side on its
  own, so this is real defense in depth, not redundant with the request-time
  validation at endpoint 1.
- **backend-developer:** `storage_key` is never accepted from a client on
  any endpoint — it's generated server-side at endpoint 1 and never exposed
  in any response (the client only ever sees `uploadUrl`/`playbackUrl`,
  which are presigned URLs, not the raw key).
- **frontend-developer:** endpoint 1 → direct `PUT` to `uploadUrl` (not
  through the API) → endpoint 2 is the required sequence; don't skip step 2
  even if the `PUT` appears to succeed client-side, since `published`/
  `expiresAt` are only ever set by `complete`.
- **frontend-developer:** on `422 caption_rejected_by_filter`, keep the
  typed caption in the input for editing, same convention as chat's
  `message_rejected_by_filter`.
- **frontend-developer:** a `403 consent_required` on the feed `GET` itself
  (not just upload) means the client needs a "waiting for parent approval"
  state for the *feed screen*, not only the upload button — don't assume
  consent-gating only ever affects a single button, per this contract's
  stricter-than-chat posture.
- **ux-designer:** the "tag a teammate to challenge them" flow, the
  report-reason copy (note the video-specific `appears_without_consent`
  reason, not just chat's generic reasons), and the feed's empty/waiting/
  consent-pending states are not designed here.
- **ux-designer:** per ADR-0010's "left open" note — whether an existing
  chat block should also affect the video feed is not decided; flagged for
  your flow pass, not assumed either way in this contract.
- **security-reviewer:** this is a blocking review before backend-developer
  builds anything, per CLAUDE.md and the Phase 3 checklist's explicit
  ordering. Confirm in particular: the bucket truly has no public/anonymous
  read path; every clip read (feed fetch, playback URL minting) re-checks
  `team_id` on every request rather than trusting a cached/previously-issued
  URL; the auto-hide-on-report reasoning (ADR-0010 Decision 4) is an
  acceptable trade at this beta's scale, the same kind of judgment call
  ADR-0007 asked for on chat; `storage_key` truly never accepts client
  input anywhere; and the retention sweep's delete-object-then-delete-row
  ordering doesn't leave a reachable-but-should-be-gone object anywhere
  (it shouldn't — bucket access requires a live row to mint a URL — but
  confirm directly rather than take this contract's word for it).
  **Additionally, once implemented**: confirm the metadata-stripping remux
  (endpoint 2) actually runs — and actually removes location data — on a
  real device-recorded file with GPS embedded (not just a synthetic test
  file with no metadata to begin with), and that there is no code path that
  sets `status: 'published'` without that step having succeeded first;
  confirm the `pending_upload` TTL sweep actually reclaims both the object
  and the row, not just one of them, on a genuinely abandoned upload.
- **ux-designer:** the parent-notification email copy for a clip report
  (ADR-0010 Decision 4) should read as neutral/informational, not
  accusatory — a single, unverified report both hides the clip and
  triggers this email, so the copy shouldn't imply guilt has already been
  established (security-reviewer's note, non-blocking but worth getting
  right in the first draft rather than fixing after a parent reads an
  accusatory-sounding email about their child).
- **code-critic:** the feed query's `status`/`team_id` filtering (endpoint
  3) and the report/auto-hide/rate-limit logic (endpoint 5) are the two
  places worth the most scrutiny, same posture as the chat contract's
  equivalent note.
