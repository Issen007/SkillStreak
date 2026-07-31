# 0017 - Chat message clip attachments

## Status

Proposed — 2026-07-31.

## Context

`docs/BACKLOG.md`'s "Link/attach a Shorts video inside a chat message"
entry, raised 2026-07-27, reiterated directly by the project owner
2026-07-30: let a player attach one of their team's existing Shorts clips
(`docs/adr/0010-video-storage-and-serving.md`) to a team chat message
(`docs/adr/0007-team-chat.md`), so "check out this trick" can point at a
specific video instead of describing it in text.

This sits directly on top of two already-shipped, already-reviewed
features and must weaken neither:

- **ADR-0007** — `TeamChatMessage` (Postgres, team-scoped by a
  denormalized `team_id`, send-once/never-mutated, a keyword filter on
  send, per-message report with no auto-hide, per-viewer block).
- **ADR-0010** — `VideoClip` (Postgres row + MinIO bytes, team-scoped by a
  denormalized `team_id`, `status` one of `pending_upload` / `published` /
  `hidden`, auto-hide on report, self-service hard-delete, a 90-day
  rolling hard-delete retention sweep, `expiresAt`/`pending_upload` TTL
  sweeps).

The backlog entry itself frames this as "no new child-data category" —
correct, and the reason this ADR stays focused: nothing here introduces a
new kind of data about a child, it introduces a **reference** from one
already-reviewed, already-team-scoped entity to another. The actual new
risk surface is narrower and specific: can that reference be constructed
or rendered across a team boundary, and does it survive the *referenced*
row's own independent lifecycle (self-delete, report-hide, retention
expiry) cleanly. Everything below is scoped to answering those two
questions plus the three explicitly-flagged design questions (attach
mechanism's data shape, data model, moderation interplay) — not a
redesign of either feature.

`docs/adr/0008-vm-guld-cross-team-leaderboard.md` and
`docs/adr/0016-cross-team-leaderboard-fairness.md` are the two places this
codebase has had to re-prove "can a query even cross a team boundary" from
scratch rather than assume it carries over — ADR-0008's bar ("structurally
cannot return `Player` data because the table is never joined") and
ADR-0016's own re-litigation of that bar when it added a count-only join.
This ADR owes chat-message-to-clip references the same re-proof, not an
assumption that ADR-0007 and ADR-0010 having each independently solved
team-scoping means their *intersection* is automatically safe too — it
isn't automatic, and Decision 1 below is where it's actually re-proven.

## Decision — 1: team-scoping is enforced at write time (a loaded-row check) and re-verified at read time (a join predicate) — not a composite FK, not a trigger

**The requirement**: a `TeamChatMessage` referencing `clip_id` X must be
impossible to construct *or render* if `clip.team_id !== message.team_id`.

**Schema**: `TeamChatMessage` gains one new nullable column,
`clip_id uuid NULL`, a plain single-column FK to `video_clip.id`, `ON
DELETE SET NULL`. (Full shape in Decision 4.)

**A composite FK was considered and rejected.** The obvious-looking DB-level
answer is a composite foreign key — `(clip_id, team_id) REFERENCES
video_clip(id, team_id)`, backed by a new `UNIQUE (id, team_id)` constraint
on `video_clip` — which would make a cross-team reference literally
unrepresentable in the schema, no application code required. **This
doesn't work here**: `ON DELETE SET NULL` on a composite FK nulls *every*
column in that FK together, and `team_id` is one of them. A clip's
self-delete or retention-expiry hard-delete (ADR-0010 Decision 5, both
unconditional) would then null out the *message's own* `team_id` — the
column every other team-scoped read on that row depends on — not just
`clip_id`. That's a strictly worse outcome than the bug this would prevent
(a real message silently losing its team scoping is more dangerous than a
theoretical mis-scoped clip reference), so this ADR doesn't take it. A
custom `BEFORE INSERT` trigger enforcing the match without that side
effect was also considered and rejected on "boring, no new primitive"
grounds — no other feature in this codebase uses a DB trigger for
team-scoping; every prior ADR (ADR-0008, ADR-0010 Decision 2, ADR-0016)
enforces the same class of constraint in application code via **one
canonical, unavoidable code path**, and this ADR follows that precedent
instead of introducing a new mechanism for one feature.

**So the enforcement is the same two-layer application-level shape ADR-0010
Decision 2 already established for clip access itself, applied here to the
reference instead of the bytes:**

1. **Write time.** `TeamChatService.postMessage`, when `clipId` is present
   in the request, loads the `VideoClip` row by id and asserts
   `clip.teamId === teamId` (the route's own `:teamId`, already
   membership-checked) **and** `clip.status === 'published'` before the
   message is ever persisted. Either check failing is `404
   clip_not_found` — not `403` — deliberately merging "no such clip,"
   "wrong team," and "not published yet" into one response, so a player
   can't use this endpoint as an oracle to probe whether a given clip id
   exists on another team (the identical reasoning `POST
   .../clips/:clipId/complete`'s existing `404 clip_not_found` already
   uses for "no such clipId for this uploader/team").
2. **Read time.** The message-list query (`GET .../chat/messages`) resolves
   each message's attached clip via a join whose predicate includes the
   team match explicitly — `LEFT JOIN video_clip ON video_clip.id =
   team_chat_message.clip_id AND video_clip.team_id =
   team_chat_message.team_id AND video_clip.status = 'published'` — not a
   bare `id` join followed by an application-level filter. This is the
   concrete "structural, not a code-review reminder" property the task
   asks for: even if a future bug, a manual DB edit, or a data migration
   ever left a mismatched `clip_id` on a row, this query's own join
   predicate cannot surface another team's clip through it — the same
   shape ADR-0008 Decision 1 uses when it says the leaderboard query
   "structurally cannot" return `Player` data because the table is never
   named in the query, applied here as "the query structurally cannot
   return a cross-team clip because the join predicate excludes it,"
   rather than "a service method remembers to check afterward."

Both checks exist independently and do different jobs: write-time
rejects a bad reference before it's ever stored; read-time means the
*rendering* of every message — including any that predate a hypothetical
future bug, or ever got here some other way — never depends on the
write-time check having been correct. This mirrors ADR-0010 Decision 2's
own framing exactly ("two independent layers, not one").

## Decision — 2: "clip unavailable" is resolved live at read time from the clip's *current* state — no snapshot is stored on the chat message

A clip referenced by a message can later become unreachable three ways:
**self-delete** (uploader, ADR-0010 Decision 5 — hard-delete, unconditional,
even with open reports), **retention expiry** (the 90-day sweep, same hard
delete), or **report-driven hide** (ADR-0010 Decision 4 — `status` flips to
`hidden`, row and bytes still exist, pending out-of-band review).

**Decision: the chat message row stores nothing about the clip except
`clip_id` itself.** No caption snapshot, no thumbnail, no uploader name
captured at attach time. The "clip unavailable" state is computed **live**,
per read, from whichever of these is true:

- `clip_id IS NULL` (the clip's row was hard-deleted — self-delete or
  retention expiry; the `ON DELETE SET NULL` FK already did this for free,
  Decision 4), or
- the clip row still exists but `status !== 'published'` (report-hidden, or
  — defensively — somehow still `pending_upload`), or
- the read-time join predicate's team check fails (Decision 1's
  belt-and-suspenders case — should never happen given the write-time
  check, but the query doesn't rely on that).

**All three collapse to the identical response shape for the viewer: a
`clip: null` field on that message.** The client renders one generic,
unavailable state ("Videon är inte längre tillgänglig" / exact Swedish
copy ux-designer's call) — it does not, and structurally cannot, distinguish
*why* a clip is gone.

**Why no snapshot, considered and rejected explicitly**: the task frames
the risk as "must not leak the fact that a since-removed clip existed via a
broken-but-suggestive link." A snapshot (even something as small as a
cached caption or thumbnail) is exactly that link — it's data that
outlives and is independent of the clip's own current moderation state. A
report-hidden clip's *caption itself* could be the reported content (e.g.
a caption containing something a parent or coach flagged); a snapshot
would let that exact text keep rendering inside every chat message that
ever referenced it, defeating the auto-hide-on-report protection ADR-0010
Decision 4 deliberately built for the clip feed. Storing nothing and
resolving live means a hide (or delete) takes effect **everywhere** that
clip is referenced, instantly and uniformly, the same guarantee the feed
itself already gives — one source of truth for "is this clip currently
visible," never a second, driftable copy.

**Per-viewer block extends to the embed, not just the message list.**
`docs/api/phase3-contract.md`'s endpoint 3 already decided a
`TeamChatBlock` is one preference spanning both chat messages *and* clip
uploads ("a block is a single per-viewer preference spanning both chat and
clips, not two independent settings"). This ADR extends that same
precedent to the embed case: if the viewer has blocked the *clip's*
uploader (who may be a different player than the *message's* sender — any
teammate can attach any team clip, see Decision 3), the read-time query
additionally treats that clip as unavailable for that viewer specifically,
via the same per-viewer `NOT EXISTS (... TeamChatBlock ...)` filter
ADR-0007 Decision 4 already applies to sender filtering — the message text
itself stays visible (its own sender isn't necessarily blocked), only the
embed resolves to `null` for that one viewer. This is applied in the same
query as the team/status join predicate above, not a second pass.

**Interaction with ADR-0013 account erasure — confirmed, no new work
needed.** Erasure hard-deletes an erased player's own `VideoClip` rows
(object first, then row — ADR-0013 Decision 6, reusing the exact
self-service delete mechanism) and separately anonymizes their
`TeamChatMessage` rows (`sender_player_id` → `NULL`, `content` → a fixed
placeholder). Any message — sent by anyone — that referenced one of the
erased player's now-hard-deleted clips falls out of the picture for free:
the existing `ON DELETE SET NULL` FK fires exactly as it would for a
self-delete or retention expiry, no new erasure-path code required. A
message *sent by* an erased player that referenced *someone else's*
still-live clip keeps `clip_id` intact — the anonymizing `UPDATE` only
touches `sender_player_id`/`content`, per ADR-0013 Decision 6's exact
column list — which is correct: the attached clip belongs to whoever
uploaded it, unaffected by the sender of the message that referenced it
being erased.

## Decision — 3: attach at compose time, from the existing team feed endpoint — no new endpoint

**Confirms the backlog's own instinct.** Given the data model above (any
teammate's `published` clip is a valid attachment target — not just the
attaching player's own uploads; see the write-time check in Decision 1,
which only asserts team + `published`, not `uploaderPlayerId ===
requesterId`), the picker's data need is exactly "this team's recent
published clips, as visible to me" — which is precisely what `GET
/api/v1/teams/:teamId/clips` (`docs/api/phase3-contract.md` endpoint 3)
already returns: team-scoped, `published`-only, viewer's-own-block-filtered,
paginated, freshly-presigned `playbackUrl` per item. **No new endpoint is
needed for the picker.** ux-designer's compose-time flow (a "pick a clip"
sheet/modal opened from the chat composer) calls this existing endpoint
exactly as the Shorts feed screen already does; the only new client-side
behavior is *which screen* calls it and *what happens on selection*
(populate `clipId` on the compose request, Decision 5), not a new backend
capability.

This also answers, structurally, "why not paste/share a raw link from the
Shorts tab": there is no raw, shareable clip URL anywhere in this app to
paste in the first place (`playbackUrl` is a short-lived presigned GET,
never a stable link — ADR-0010 Decision 2) — the compose-time-picker
approach isn't just the nicer UX, it's the only shape that's actually
consistent with how clip access already works. A "paste a link" flow would
require inventing a new, stable, shareable clip identifier/URL that
doesn't exist today and that this app's whole access model (fresh
presigned URLs, never persisted or reused) deliberately avoids — a much
bigger, unrelated change this ADR isn't making.

**Attaching is not conditioned on the attacher's own block list, only on
team + published status.** A block is a *read-time* viewer preference
(Decision 2); it was never treated as a *write-time* eligibility gate
anywhere else in this app (a blocked sender isn't prevented from sending,
only from being seen by the blocker — ADR-0007 Decision 4). Consistent
with that, the write-time clip-attach check doesn't re-derive or care
about the attaching player's own block list — kept simple, one rule
("team + published"), stated explicitly so it isn't left ambiguous.

**One clip per message, not multiple** — matches the backlog's own
"reference **one** of their team's existing Shorts clips" framing and the
1:0/1 shape a single nullable FK column naturally expresses (Decision 4).
Nothing here forecloses multi-attachment later, but nothing asks for it
either.

## Decision — 4: data model — a nullable `clip_id` column on `TeamChatMessage`, not a join table or a message-kind discriminator

**Two alternative shapes considered:**

- **A join table** (`TeamChatMessageClip`) — the right shape for a
  many-to-many or multiple-attachments-per-message relationship. Rejected:
  Decision 3 settled on exactly one optional clip per message, the same
  cardinality every other single-optional-reference field in this
  codebase already uses as a plain nullable FK column, not a join table
  (`TrainingLogEntry.challenge_id`, `VideoClip.taggedPlayerId`). A join
  table here would be schema ceremony for a relationship this app doesn't
  have.
- **A `kind` discriminator enum** (`'text' | 'clip'`) alongside `clip_id`
  — rejected as redundant: `clip_id IS NOT NULL` already discriminates
  "has an attachment" unambiguously, and Decision 3 allows text to
  accompany a clip (see below), so `kind` would never actually gate which
  fields are populated the way a real discriminated union does elsewhere
  in this app (e.g. `BadgeAward.context`) — it would just be a second,
  derivable copy of `clip_id IS NOT NULL` that could drift from it.

**Chosen: `TeamChatMessage.clip_id uuid NULL`, single-column FK →
`video_clip.id`, `ON DELETE SET NULL`.**

```
TeamChatMessage (additions only — every existing column unchanged)
  ...
  clip_id             uuid, nullable, FK -> video_clip.id, ON DELETE SET NULL
                                                       -- Decision 1: team-match
                                                          enforced at write time,
                                                          re-verified at read
                                                          time via join predicate,
                                                          NOT a composite FK.
                                                          Decision 2: no other
                                                          clip data is ever
                                                          stored alongside this.
```

**`content`'s validation relaxes, its column does not.** `content` stays
`varchar(500) NOT NULL` in the schema (no migration to the existing
column) — the change is at the DTO/service validation layer: `content`
must be non-empty (1-500 chars, trimmed) **unless** `clipId` is present,
in which case an empty string is a valid value (a player attaching a clip
with nothing else to say). **A message must contain at least one of
non-empty `content` or a `clipId`** — both absent/empty is `400`, the same
"reject a message with nothing in it" rule the existing endpoint already
enforces for text-only messages, just restated to account for the new
alternative way a message can carry meaning.

**Migration shape** (next migration after
`1785500000000-AddAccountErasure.ts`, hand-trimmed the same way every
prior migration in this project is, per that file's own class-comment
convention):

```sql
ALTER TABLE "team_chat_message" ADD "clip_id" uuid;
CREATE INDEX "IDX_team_chat_message_clip_id"
  ON "team_chat_message" ("clip_id") WHERE "clip_id" IS NOT NULL;
  -- partial index: only the (expected to be small) subset of messages
  -- that carry an attachment ever need this lookup path.
ALTER TABLE "team_chat_message"
  ADD CONSTRAINT "FK_team_chat_message_clip"
  FOREIGN KEY ("clip_id") REFERENCES "video_clip"("id") ON DELETE SET NULL;
```

No change to `VideoClip`, `ClipReport`, or any existing table/index — this
ADR only adds one nullable column + index + FK to `TeamChatMessage`.

## Decision — 5: API contract — one endpoint request field, two endpoint response fields, one new error code (reused)

Extends `docs/api/phase2.6b-contract.md`. No change to
`docs/api/phase3-contract.md` (Decision 3 — the feed/picker endpoint is
reused unmodified).

### `POST /api/v1/teams/:teamId/chat/messages` (endpoint 1) — request gains `clipId`

```ts
{
  content: string;    // 1-500 chars trimmed IF clipId absent; 0-500 chars if clipId present
  clipId?: string;    // must resolve to a published clip on this team (Decision 1)
}
```

Check order (clip resolution inserted after the existing consent gate,
before the existing moderation check — so an invalid clip reference is
rejected before spending a moderation check on text that would be
discarded anyway):

1. `team_mismatch` (unchanged).
2. `consent_required` (unchanged).
3. **New**: if `clipId` present, resolve + validate (Decision 1) — `404
   clip_not_found` on failure.
4. `400` — both `content` empty/whitespace-only **and** `clipId` absent
   (new combined rule, Decision 4); or `content` over the length cap.
5. `422 message_rejected_by_filter` on non-empty `content` (unchanged —
   still only ever runs against `content`; a clip's own `caption` was
   already moderation-checked at upload time per
   `docs/api/phase3-contract.md` endpoint 1, so it is deliberately **not**
   re-checked here).
6. `429 chat_send_rate_limited` (unchanged — no separate/additional rate
   limit for clip attachment; the existing per-sender chat cooldown is
   judged sufficient, stated explicitly so this isn't left ambiguous).

Response `201` gains a nullable `clip` block:

```json
{
  "id": "uuid",
  "teamId": "uuid",
  "senderPlayerId": "uuid",
  "senderScreenName": "FloorballStar15",
  "senderAvatarId": "fox",
  "content": "Kolla den här fintan!",
  "clip": {
    "clipId": "uuid",
    "uploaderPlayerId": "uuid",
    "uploaderScreenName": "ZorroKing09",
    "uploaderAvatarId": "wolf",
    "caption": "Zorro-fint #47!",
    "playbackUrl": "https://minio.internal/clips/...(presigned GET, freshly minted this request)...",
    "createdAt": "2026-07-20T18:07:00Z"
  },
  "createdAt": "2026-07-31T18:04:00Z"
}
```

`clip` is `null` when no `clipId` was sent. When a `clipId` was sent and
accepted, `clip` is always populated in this response (it was just
validated as `published` one query earlier in the same request) — the
`null`-on-unavailable case only ever arises later, on `GET`, per
Decision 2.

### `GET /api/v1/teams/:teamId/chat/messages` (endpoint 2) — response gains `clip`

```json
{
  "messages": [
    {
      "id": "uuid",
      "senderPlayerId": "uuid",
      "senderScreenName": "FloorballStar15",
      "senderAvatarId": "fox",
      "content": "Kolla den här fintan!",
      "clip": {
        "clipId": "uuid",
        "uploaderPlayerId": "uuid",
        "uploaderScreenName": "ZorroKing09",
        "uploaderAvatarId": "wolf",
        "caption": "Zorro-fint #47!",
        "playbackUrl": "https://minio.internal/clips/...(presigned GET, freshly minted this request)...",
        "createdAt": "2026-07-20T18:07:00Z"
      },
      "createdAt": "2026-07-31T18:04:00Z",
      "reportedByMe": false
    }
  ]
}
```

- `clip` is `null` whenever: the message never had a `clipId`; the
  referenced clip is gone (self-deleted or expired, `clip_id` now `NULL`
  on the row); the referenced clip is `hidden`; or the viewer has blocked
  the clip's `uploaderPlayerId` (Decision 2). The client cannot and should
  not try to distinguish these — one placeholder, always.
- `playbackUrl`, like the feed's own, is a fresh presigned GET **minted for
  this exact response** — never cached/reused across requests/polls, same
  rule as `docs/api/phase3-contract.md` endpoint 3.
- Every existing field/filter on this endpoint (hidden-message filter,
  per-viewer sender block filter, `reportedByMe`) is unchanged.

### New error code (reused, not invented)

`404 clip_not_found` on `POST .../chat/messages` — identical code and
semantics to the existing `docs/api/phase3-contract.md` endpoint 2's `404
clip_not_found` ("no such clipId for this uploader/team, or it's not in
the right state"), reused here rather than minting a chat-specific
variant, since the meaning is the same: this clip id doesn't resolve to
something the requester is allowed to reference right now.

## Decision — 6: moderation/notification interplay — reporting a message with a clip attachment does exactly what reporting any other message does, no special case

Stated explicitly, per the task's instruction not to leave this
ambiguous: **no.** `POST .../chat/messages/:messageId/report` (ADR-0007
Decision 3) is unchanged — it persists a `TeamChatMessageReport` row keyed
on `message_id`, sends the same two best-effort rate-limited emails to the
*message sender's* parent/coach, and never auto-hides anything, regardless
of whether that message carries a `clip_id`. Reporting a message never
reports, hides, or otherwise touches the attached clip's own row —
`ClipReport`/`VideoClip.status` are a fully separate entity/flow with
their own rate limit and their own (deliberately different, per ADR-0010
Decision 4) auto-hide-on-report behavior. The two report flows stay
independent because they're reports about different things: a message
report is about *this message* (its text, or the act of attaching this
clip in this context); a clip report is about *the clip's own content*,
which the existing `POST .../clips/:clipId/report` endpoint already
handles regardless of which screen a player reaches a `clipId` from.

**Consequence worth surfacing for ux-designer, not decided here**: if a
player wants to report the *clip itself* (not the message) from inside the
chat embed, that's just the existing clip-report endpoint called with the
`clipId` already on hand from the message — no backend change needed, only
a UI affordance decision (does tapping the embed offer both "report this
message" and "report this clip" as distinct actions, mirroring the
existing message-report-vs-block distinction `docs/api/phase2.6b-contract.md`'s
implementer notes already flag as "two different affordances with two
different scopes"). Flagged, not designed here.

**Message immutability is unaffected.** ADR-0007's "send-once, never
mutated" rule (the one narrow, documented exception being ADR-0013's own
erasure-time content anonymization) still holds: a sender cannot later
detach a clip from an already-sent message, or edit the accompanying text,
even if the clip itself later becomes unavailable — the message is exactly
what was sent; only the *rendering* of its clip reference changes over
time, per Decision 2, never the stored row.

**No new/changed rate limit.** Covered in Decision 5 (existing chat-send
cooldown applies unchanged) and restated here so it isn't rediscovered as
an open question: attaching a clip is not treated as a heavier action than
an ordinary message for rate-limiting purposes.

## Consequences

- One new nullable column + partial index + FK on `TeamChatMessage`
  (Decision 4) — no changes to `VideoClip`, `ClipReport`, or any other
  existing table.
- No new endpoint (Decision 3) — the existing `GET
  .../teams/:teamId/clips` feed endpoint doubles as the compose-time
  picker's data source, unmodified.
- `docs/api/phase2.6b-contract.md` gains: `clipId` on the send request,
  `clip` (nullable) on both the send response and the list response, one
  reused error code (`404 clip_not_found`) — `docs/api/phase3-contract.md`
  is unchanged.
- Team-scoping across the two tables is enforced at two independent
  application layers (write-time loaded-row check, read-time join
  predicate) rather than a DB-level composite FK — a composite FK was
  concretely considered and rejected because its `ON DELETE SET NULL`
  behavior would null the *message's own* `team_id`, not just the clip
  reference, on every clip self-delete/expiry (Decision 1). This is a
  deliberate, argued trade-off, not an oversight — flagged here so a
  future contributor doesn't "improve" this into a composite FK without
  re-deriving why it doesn't work.
- No clip data is ever snapshotted onto a chat message row (Decision 2) —
  a hide or delete of a clip takes effect instantly and uniformly
  everywhere it's referenced, with no second, driftable copy anywhere.
  This is also the concrete reason a report-driven clip hide can never
  leak a reported caption/thumbnail back out through a chat message that
  referenced it before the hide.
- No new Redis structure, no new background job, no new module —
  implemented entirely inside the existing `team-chat/` module's
  `TeamChatService`/`TeamChatController`/DTOs, reading `video-clips/`'s
  `VideoClip` entity directly (a new, narrow cross-module read, the same
  shape `team-chat/` already has into `player-private-info/` per ADR-0007's
  module-boundary note — worth the same kind of explicit flag here: this
  is `team-chat/`'s first dependency on `video-clips/`, one-directional,
  read-only, scoped to exactly the loaded-row/join-predicate checks in
  Decision 1).
- **Hand-off**:
  - **ux-designer**: design the compose-time clip picker (reusing the
    existing feed/`GET .../clips` data), the in-message clip-embed
    rendering (thumbnail/play affordance — note this app has no thumbnail
    image today, only `playbackUrl`; whether the embed autoplays,
    shows a static first-frame via the video element itself, or needs a
    new thumbnail concept is a UX/frontend call, not decided here), the
    generic "clip unavailable" placeholder copy (Decision 2), and whether
    the embed offers a direct "report this clip" shortcut distinct from
    "report this message" (Decision 6's flagged-not-designed question).
  - **backend-developer**: the migration (Decision 4), `TeamChatService`
    changes (clip resolution/validation at write time per Decision 1, the
    `content`-or-`clipId` combined validation per Decision 4, the join-
    predicate change to the message-list query per Decisions 1-2,
    extending the existing per-viewer block filter to the embed per
    Decision 2), and the `docs/api/phase2.6b-contract.md` updates to match
    this ADR exactly (same division of labor as every prior contract:
    architect specifies the shape, backend-developer's contract-doc edit
    is the living copy).
  - **security-reviewer**: this ADR does not, on its own, meet the
    "blocking sign-off" bar ADR-0007/ADR-0010 both required, because it
    doesn't introduce a new category of child data or a new external
    exposure surface — but given both underlying features were
    blocking-review features, a confirmation pass is still warranted
    before merge, focused on exactly two things: (1) Decision 1's
    write-time-plus-read-time team-scoping actually closes the boundary
    (no path exists to construct or render a cross-team reference), and
    (2) Decision 2's "no snapshot, resolved live" claim actually holds in
    the implementation (no cached caption/thumbnail/uploader-name field
    quietly reintroduced on `TeamChatMessage` or in any response, which
    would reopen the exact leak this ADR argues against).
