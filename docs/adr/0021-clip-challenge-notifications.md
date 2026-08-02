# 0021 - Video-clip challenge notifications: a persistent pending-challenges surface, and team chat's first system message

## Status

Proposed — 2026-08-02. **A scoped security-reviewer pass is recommended
before backend-developer builds this — not a skip, and not the full
ADR-0007-weight blocking gate either.** Argued in Decision 5: this feature
adds no new freeform-text path, no new report/block mechanism, no
cross-team exposure, and no new external party — it stays entirely inside
the existing closed-team-bubble, already-reviewed `TeamChatMessage`/
`VideoClip` tables. But it *is* the first exception ever carved into team
chat's "every message is a real, authenticated, rate-limited player"
invariant, which ADR-0007's own review scrutinized carefully — that's
enough to warrant a real, if narrowly scoped, confirmation pass, not
architect self-certification.

## Context

The project owner, verbatim: *"When we do a challenge of a video between
teammates, it should pop up as a Team challenge and also be a text notice
in the team chat."*

**What already exists (confirmed by direct code investigation):**

- `VideoClip.taggedPlayerId` (`backend/src/video-clips/entities/video-clip.entity.ts`)
  is a dormant FK, set at `createUploadUrl` time when a player tags a
  teammate to challenge them — per `docs/adr/0010-video-storage-and-serving.md`
  Decision 3, "an ordinary FK reference, not a claim about who appears on
  camera."
- Today this drives only **client-side, best-effort, one-time** UI:
  `mobile/src/clips/ClipsScreen.tsx`'s `checkForChallengeBanner` shows a
  toast only if the tagged player happens to open the Clips tab while that
  specific clip is still in their currently-fetched feed page, and tracks
  "already seen" in `mobile/src/api/localFlags.ts`'s
  `getSeenChallengeClipIds`/`addSeenChallengeClipId` — **`AsyncStorage`,
  per device, not per account.** A reinstall, a new phone, or simply never
  opening the Clips tab at the right moment means the challenge is silently
  missed, permanently — there is no persisted, account-level "you were
  challenged" record anywhere, confirmed by reading the entity and every
  caller of `taggedPlayerId` directly, not assumed.
- **Team chat has zero precedent for a system/automated message.** Every
  `TeamChatMessage.senderPlayerId` in this app's history is a real,
  currently-authenticated player who passed `assertTeamMembership`
  (`TeamChatService.postMessage`). The only place `senderPlayerId` is ever
  `NULL` today is `docs/adr/0013-account-erasure.md` Decision 6's
  retroactive anonymization of a **past real player's** message — a
  different thing from a system-authored concept, and one this ADR must
  not collide with (Decision 2).
- **Naming collision risk, already anticipated once**:
  `docs/adr/0005-kapten-and-weekly-team-goal.md` reuses a `Challenge`
  entity/table for "veckans mål" (the weekly team goal), and explicitly
  flagged that *"a distinct future 'individual challenge' feature, if ever
  built, might legitimately want the same generic shape under the same
  name."* This ADR resolves that concern the simplest possible way: see
  Decision 1 — no new `Challenge`-named (or `TeamChallenge`-named) entity
  is introduced at all.

`docs/PROJECT.md`'s own original pitch already names this feature in
Swedish — *"De kan också 'taga' en lagkompis och utmana dem"* ("tag a
teammate and challenge them") — using **"utmana"/"utmaning"**, a different
Swedish word from **"veckans mål"** (the weekly goal's actual product
name). The English word "challenge" is overloaded between two unrelated
product concepts in this codebase; Swedish product copy already
disambiguates them. Worth stating explicitly so a future contributor
reading English code/comments doesn't conflate the two or try to unify
them into one system — they're different features that happen to share an
English gloss.

## Decision — 1: scope — extend the existing dormant `taggedPlayerId` mechanism with one server-side timestamp column; no new lifecycle entity

Two candidate shapes, per the task's own framing:

- **(A) A lightweight enhancement**: a real, server-side "pending
  challenges for me" surface, computed from `VideoClip.taggedPlayerId`
  plus a new acknowledged/unacknowledged state — no new entity.
- **(B) A heavier, full challenge-lifecycle entity** (issued → accepted/
  declined → responded-with-clip → completed), needing its own name
  (`ClipChallenge` or similar) per the naming-collision concern above.

**Decision: (A).** Reasoning, in this codebase's own established style
(the same instinct ADR-0018 used to pick a single fixed-vocabulary tag
over a RAG database, and ADR-0020 used to pick a scheduled aggregate query
over a general event-tracking pipeline):

- Nothing in the project owner's request, `docs/PROJECT.md`'s original
  pitch, or any existing UI asks for accept/decline semantics — a
  "challenge" here has only ever meant "a teammate tagged you in a clip,"
  full stop. A player "responds" to a challenge today simply by uploading
  their own clip and optionally tagging the original challenger back —
  that already works, unassisted, with the existing dormant FK. Building a
  formal state machine (accepted/declined/responded/completed) would be
  new product surface nobody asked for, on top of the actual request
  (visibility + a chat notice), and would need its own ux-designer pass
  for states that currently have no product meaning.
- **What "pop up as a Team Challenge" concretely means, in this design**:
  a real, persistent, server-computed "pending challenges for me" list —
  not the current one-shot toast that's easy to miss and lost on
  reinstall. Recommended surfaced in the **Laget (Team) tab** (the same
  screen area the weekly goal already lives in, giving the two concepts
  visual parity without sharing any schema) as a badge/counter plus a
  short list, exact placement and visuals **ux-designer's call, not fixed
  here**.
- This is a schema-light change (one nullable timestamp column, one
  partial index, two small endpoints), not a new draft→active→completed
  state machine to design, build, and review — the "boring, easy to
  change" option CLAUDE.md asks for, and because there's no new entity,
  **the naming-collision risk from Context evaporates at the schema
  level**: there is no new `Challenge`/`TeamChallenge` table to name at
  all.

### Schema — one new column on `VideoClip`, one partial index

```sql
ALTER TABLE "video_clip" ADD "challenge_acknowledged_at" timestamptz;
CREATE INDEX "IDX_video_clip_pending_challenge"
  ON "video_clip" ("tagged_player_id")
  WHERE "status" = 'published' AND "challenge_acknowledged_at" IS NULL;
  -- partial index: backs exactly the "pending challenges for me" query
  -- below; only ever a small, bounded subset of rows.
```

`challenge_acknowledged_at` (nullable, default `NULL`): set exactly once,
by the tagged player, via the new ack endpoint below. `NULL` means "still
a pending challenge for the tagged player," and is only ever meaningful
when `taggedPlayerId IS NOT NULL AND status = 'published'` — the same
"meaningless outside its one real context" shape `goalBonusAwardedAt`
already has on `Challenge` (ADR-0005).

**Code comment cross-reference required (backend-developer)**: the column
comment on `challenge_acknowledged_at` must note, verbatim or close to it,
that this is the "tag a teammate to challenge them" video-clip feature,
**distinct from** the `Challenge` entity (the weekly team goal) — pointing
at ADR-0005's own anticipation of this exact naming overlap — so a future
contributor doesn't try to merge the two.

### New endpoints (extends `docs/api/phase3-contract.md`)

```
GET  /api/v1/teams/:teamId/clips/challenges/pending
  -> { challenges: [{ clipId, uploaderPlayerId, uploaderScreenName,
                       uploaderAvatarId, caption, playbackUrl, createdAt }] }
  Gates identical to the existing GET .../clips feed (listClips):
  assertTeamMembership, assertConsentApproved, assertTeamJoinApproved —
  on the REQUESTER (the viewer/tagged player), unchanged pattern, not a
  new precedent. Filters WHERE tagged_player_id = requesterId AND
  status = 'published' AND challenge_acknowledged_at IS NULL. Team sizes
  are small ("a handful," this codebase's standing capacity assumption) —
  no pagination needed, same call every other small-list endpoint here
  already makes.

POST /api/v1/teams/:teamId/clips/:clipId/challenge-ack
  -> { clipId, acknowledged: true }
  Tagged-player-only: 403 (new NotYourChallengeException, mirroring the
  existing NotYourClipException's shape/naming for uploader-only actions)
  if requesterId !== clip.taggedPlayerId. Idempotent — acking an
  already-acked challenge is a 200 no-op, same idiom as
  TeamChatBlock's idempotent block (ADR-0007 Decision 4): this is a
  personal "I've seen it" state, not an accusation or a one-time resource,
  so repeat calls carry no signal worth protecting against.
```

**Exact trigger for calling `challenge-ack`** (auto-fired on viewing the
clip vs. an explicit "dismiss" tap) is a UX interaction-layer choice,
**ux-designer's call, not decided here** — the API only needs the
timestamp to exist and be settable; when the client chooses to set it is
a product decision, same posture this codebase already takes for exact
button copy/placement throughout (see e.g. ADR-0013's `GET .../erasure/
status` banner).

### Supersedes the client-local "seen" tracking — a real bug, not just a smaller feature

`mobile/src/api/localFlags.ts`'s `getSeenChallengeClipIds`/
`addSeenChallengeClipId` (AsyncStorage, per-device) should be **removed**,
not kept alongside the new server-side field — the two would otherwise
drift (a challenge acked on one device could still show as "new" on
another, or vice versa), and the server-side `challengeAcknowledgedAt` is
strictly better: durable, per-account, survives reinstall. Flagged
explicitly for frontend-developer as a concrete fix this ADR enables, not
an optional cleanup.

## Decision — 2: the chat system message — a real `authorType` discriminator, not an overload of the existing nullable `senderPlayerId`

**Schema — two additions to `TeamChatMessage`:**

```sql
ALTER TABLE "team_chat_message"
  ADD "author_type" varchar NOT NULL DEFAULT 'player';
  -- enum('player','system') at the TypeORM/entity level, matching this
  -- codebase's existing enum-column convention.
ALTER TABLE "team_chat_message"
  ADD "system_event_type" varchar NULL;
  -- enum('clip_challenge_issued'), NULL for author_type='player'. A
  -- discriminated-union extension point in the same spirit as
  -- BadgeAward.context's triggerReason (ADR-0002 addendum) — room for a
  -- future second system-event kind without a new column.
```

**Why a real discriminator, not "reuse `senderPlayerId IS NULL`" (the
cheaper-looking option, considered and rejected)**: `senderPlayerId` is
already nullable, post-ADR-0013 — but it's nullable for a completely
different reason (a **real** message whose sender's account was later
erased, content anonymized in place per ADR-0013 Decision 6). Overloading
the same `NULL` to also mean "this was never a real message" would make
those two cases indistinguishable from each other at read time — a bug
waiting to happen (e.g. a future feature rendering "this teammate's
account was deleted" for what's actually a system announcement, or vice
versa). `author_type = 'system'` unambiguously means "never had a real
sender, from creation"; `author_type = 'player'` + `sender_player_id IS
NULL` unambiguously still means exactly what ADR-0013 already established
("a real player, since erased"). No ambiguity, one column doing one job —
the same "structural, not a code-review reminder" bar this codebase holds
itself to elsewhere (ADR-0008, ADR-0010 Decision 2, ADR-0017 Decision 1).

**`content` is a fixed, templated, server-rendered string — never
freeform, filled in once at send time.** E.g. (exact Swedish copy
ux-designer's call): *"{uploaderScreenName} utmanade {taggedScreenName}
med en video!"* The only two variables are the uploader's and tagged
player's **current screen names at the moment the clip is published** —
already-validated, already-displayed-unfiltered-elsewhere strings (the
same ones shown on the roster, the leaderboard, every ordinary chat
message's own sender name, and the existing challenge toast's own
`t('v2.challengeBanner', { screenName })` call) — never a caption, never
any other player-supplied freeform text. This matches this codebase's
standing instinct toward fixed/allow-listed shapes for anything derived or
automated (`BadgeAward.context`, `VideoClipTag`'s fixed vocabulary).

**Not re-resolved live from the clip at read time — a deliberate departure
from ADR-0017 Decision 2's "no snapshot, resolve live" precedent, reasoned
through explicitly, not copied by default:** ADR-0017 stores nothing about
an *attached* clip on the chat message because losing the clip only costs
the *attachment* — the message's own human-authored `content` survives
independently, unaffected. Here, if screen names were resolved live from
`clip.uploaderPlayerId`/`clip.taggedPlayerId` instead of baked into
`content`, then the clip's own later hard-delete (self-delete, or the
90-day retention sweep — both ordinary, expected, unconditional events per
ADR-0010 Decision 5) would silently degrade **the entire announcement**,
not just an attachment, into a placeholder — a materially worse
continuity loss than ADR-0017's case, since there'd be nothing left of the
sentence at all. Baking the two screen names into `content` once, at
publish time, keeps the announcement's own meaning independent of the
clip's later lifecycle, exactly the same as any ordinary human-authored
chat message already is. The `clip_id` column (reused as-is from
ADR-0017, no new column needed) is still attached for the optional embed/
playback affordance, and *that* embed still degrades to the existing
generic "clip unavailable" placeholder on delete/hide, per ADR-0017
Decision 2, unchanged — only the announcement text itself is exempted
from live-resolution, not the attachment.

**Fires once, from `VideoClipsService.completeUpload`, not from
`createUploadUrl`.** A clip only becomes visible/real to the team once it
reaches `published` (post-remux, per ADR-0010 Decision 3) — posting the
announcement any earlier (at `createUploadUrl`/`pending_upload` time)
could reference a clip that's later abandoned (never completed, swept
away by the existing `pending_upload` TTL sweep) or fails the remux step
entirely, leaving a confusing chat message pointing at nothing. This
mirrors ADR-0017 Decision 1's own "must be `published`" rule for clip
references in chat exactly — not a new rule invented for this feature.

**Transactional, inside the same DB transaction as the publish-status
flip.** `completeUpload`'s existing `UPDATE video_clip SET status =
'published', expiresAt = ...` and the new `TeamChatMessage` insert (only
when `clip.taggedPlayerId IS NOT NULL`) happen in one `dataSource
.transaction(...)` block — both succeed together or neither does, the
same "one more step in the same transaction" pattern ADR-0005's
goal-bonus check already established for exactly this shape of problem
(no new scheduled job, no eventual-consistency window, no external I/O
involved in this step so no reason to split it into a best-effort
try/catch the way an email send would be).

**Module wiring**: `VideoClipsModule` needs to write a `TeamChatMessage`
row, but `TeamChatModule` already imports `video-clips/`'s `VideoClip`
entity (ADR-0017's "team-chat's first dependency on video-clips,
one-directional, read-only"). Writing the other direction too — video-clips
calling into `TeamChatService.postMessage` — would both create a module
cycle and drag in `postMessage`'s entire consent/rate-limit/moderation
pipeline, none of which applies here (Decision 3). Resolved the same way
`PlayersModule`/`WeeklyGoalModule` already avoid an equivalent cycle
(ADR-0013 Decision 4): `VideoClipsModule` registers `TeamChatMessage` via
its **own** `TypeOrmModule.forFeature([TeamChatMessage])` and inserts the
row as a plain repository write inside `completeUpload`'s transaction —
not a service-to-service call into `TeamChatService`.

## Decision — 3: interaction with every existing invariant `postMessage` currently assumes

Stated explicitly for each, per the task's instruction not to silently
skip any of them:

- **`assertTeamMembership`**: not applicable. The system message is never
  written through `TeamChatService.postMessage`'s HTTP path at all (it's a
  direct repository insert from `completeUpload`, per Decision 2's module
  wiring) — there is no request, no requester, nothing to authenticate.
  Concretely, this also means **`authorType`/`systemEventType` are never
  client-settable**: no DTO on `POST .../chat/messages` exposes either
  field, so no path exists for a player to forge a system-authored
  message through the ordinary send endpoint. Worth confirming directly in
  review (Decision 5), not just asserting here.
- **Per-player rate limit (`tryClaimChatSendAllowance`)**: not applied —
  there is no real sender's quota to charge. Message volume is already
  structurally bounded by the **existing** `tryClaimClipUploadAllowance`
  cooldown on clip uploads (ADR-0010): at most one challenge announcement
  per completed, tagged upload, which is already rate-limited. No new
  Redis key or rate-limit dimension is introduced.
- **Keyword moderation (`ChatModerationCheck`)**: not run, and this is a
  deliberate decision, not a silent skip. The only variable content is two
  screen names already displayed, unmoderated, everywhere else in this app
  (team roster, leaderboard, every ordinary message's own sender name, the
  pre-existing challenge toast). Running the filter against a fixed
  template whose only free variables are values already shown unfiltered
  elsewhere adds no real protection, and there is no sane user-facing
  outcome for "your teammate's own screen name happened to match a
  keyword, so the system couldn't announce your challenge" — not built.
  If screen-name moderation is ever judged insufficient, the right fix is
  moderating screen names at **account-creation time** (an existing,
  separate surface — `ScreenNameTakenException` already exists, but no
  keyword filter on screen name content was found in this pass), not
  re-filtering every place a screen name is later displayed.
- **Report (`POST .../chat/messages/:messageId/report`)**: **explicitly
  disabled for system messages, enforced server-side, not left to a
  client-side UI omission.** A new guard rejects a report attempt against
  any `author_type = 'system'` row (`400`, reusing the existing exception
  taxonomy shape — exact code backend-developer's call, e.g.
  `cannot_report_system_message`). Reasoning: ADR-0007 Decision 3's entire
  report mechanism exists to email **a real reported player's** parent/
  coach — there is no reported player for a system-authored row, so a
  report here could never resolve to any real accountability action; it
  would just be a `TeamChatMessageReport` row with a reporter and no
  meaningful target, which is worse than not accepting the report at all.
- **Block (`TeamChatBlock`)**: **structurally, never matches a system
  message, by construction, not by a special case.** The existing
  block filter is `NOT EXISTS (... blocked_player_id = message
  .sender_player_id ...)`; a system message's `sender_player_id` is always
  `NULL`, and `blocked_player_id = NULL` can never be true for any bound
  parameter — so no player's block list can ever suppress a system
  message today, with zero new code. Judged acceptable, stated explicitly
  rather than left ambiguous: there's no freeform-content risk here for a
  block to protect against (Decision 2's fixed-template guarantee), and
  volume is inherently bounded by the clip-upload rate limit above — the
  same reasoning that makes report unnecessary applies to why an
  un-blockable system announcement isn't a new harassment vector.
- **The tagged player's own consent/team-join status**: the existing
  `taggedPlayerId` check at `createUploadUrl`
  (`video-clips.service.ts`) validates only `tagged.teamId === teamId` —
  confirmed by reading the code directly, **no check on the tagged
  player's `parentalConsentStatus` or `teamJoinStatus` exists today.**
  This ADR's two new surfaces (the persistent pending-challenges list, and
  the chat announcement naming them) meaningfully raise that gap's stakes
  versus today's near-invisible dormant FK, so it needs a real answer:
  - **No new consent gate on the tagged player specifically.** Being
    named in an automatic system announcement, or appearing in someone
    else's "pending challenges" query, is a read/mention-shaped event —
    the same category as a not-yet-consented player's screen name already
    appearing, ungated, on the team roster and leaderboard today (ADR-0007
    Decision 5's own precedent: "reading is left ungated on consent...a
    pending-consent player can already see the team's other read-only
    surfaces"). It is not the tagged player's own account
    uploading/processing media, which is the thing CLAUDE.md's
    parental-approval constraint actually gates.
  - **A real, if narrow, tightening: require `tagged.teamJoinStatus ===
    TeamJoinStatus.APPROVED`** before `taggedPlayerId` is accepted at all
    (`createUploadUrl`). Confirmed by reading `PlayersService`
    (`team-join-status.enum.ts`) that a player can hold `teamId` while
    still `teamJoinStatus = PENDING` (awaiting captain approval to
    actually join the roster) — meaning, today, a not-yet-approved
    pending joiner **can already be tagged**, a small pre-existing gap
    this design surfaces and closes rather than silently inherits. Once
    this feature makes tagging materially more visible (a durable chat
    broadcast, not a dormant FK), naming someone who isn't even a
    confirmed team member yet is worth explicitly ruling out.
  - **The requester-side (viewer's own) gates on the new pending-list
    endpoint are unchanged from `listClips`** — `assertConsentApproved`/
    `assertTeamJoinApproved` on whoever is calling `GET .../challenges
    /pending`, exactly the existing pattern, not a new one.

## Decision — 4: erasure/retention interaction

Walked through against `docs/adr/0013-account-erasure.md`'s existing
per-entity table, confirming (per that ADR's own established practice,
e.g. ADR-0017/ADR-0018's "confirmed, no new work needed" notes) whether
this feature needs its own new row there — **it doesn't**, for the
following reasons, stated explicitly rather than assumed:

- **Uploader (challenger) erased**: `VideoClip` (theirs) is hard-deleted
  per ADR-0013 Decision 6, exactly as today. The system chat message's
  `clip_id` FK (reused from ADR-0017, `ON DELETE SET NULL`) fires
  automatically — the same mechanism ADR-0017 already relies on for any
  message that attached a now-deleted clip. The announcement's own
  `content` text (baked in at publish time, per Decision 2) is
  **unaffected** — it survives with the uploader's screen name still in
  it, exactly the same accepted limitation as any ordinary chat message
  that happens to freely mention another player's screen name in its own
  human-authored text already survives that player's erasure today
  (ADR-0013 never attempts to scrub free-text mentions — this isn't a new
  gap this feature introduces, it's the same one, extended to one more
  templated case).
- **Tagged player erased**: `VideoClip.taggedPlayerId` already goes to
  `NULL` on erasure (existing `ON DELETE SET NULL`, ADR-0010) —
  unaffected by anything new here, since the chat message's `content`
  never depended on that FK (it was baked in at publish time). The
  `challenge_acknowledged_at` column simply becomes moot on a row that no
  longer names them; no cascade or anonymization needed since the column
  lives on `VideoClip` (already fully handled per ADR-0013's existing
  per-table treatment of that entity), not on a row scoped to the tagged
  player themselves.
- **`sender_player_id` is never involved, for either named player, in
  either direction.** ADR-0013's chat-anonymization walk matches rows
  `WHERE sender_player_id = :erasedPlayerId`. A system message's
  `sender_player_id` is always `NULL` **from creation** (Decision 2), for
  both the uploader and the tagged player — neither is ever this row's
  `sender_player_id`, so that walk never touches these rows regardless of
  which of the two named players is later erased. No ambiguity, no new
  code path, and — per Decision 2's own reasoning — no risk of confusing
  "system, never had a sender" with "player, sender since erased," since
  `author_type` already disambiguates the two cases the erasure walk would
  otherwise have to reason about.
- **No change needed to `docs/adr/0013-account-erasure.md`'s Decision 6
  table or its migration list** — every new column/FK this ADR adds
  either reuses an existing cascade (`clip_id`) or lives on an entity
  whose erasure treatment is already fully specified
  (`challenge_acknowledged_at` on `VideoClip`). This ADR states the
  interaction explicitly (this section) rather than amending ADR-0013
  itself, the same posture ADR-0017/ADR-0018 already took for their own,
  smaller interactions with it.

## Decision — 5: security-reviewer scope — narrow, not skipped, not full weight

Argued explicitly, per the task's instruction not to default to either
extreme:

**Why not a full ADR-0007-weight blocking review**: this feature adds no
new freeform-text input path (the only variable content is two
already-unmoderated-elsewhere screen names, Decision 2), no new report/
block mechanism (both are explicitly disabled/structurally inert for
system rows, Decision 3), no cross-team exposure (everything stays inside
the existing team-scoped `VideoClip`/`TeamChatMessage` tables, reusing
existing FKs), and no new external party or sub-processor. It's a smaller
addition on top of two already-reviewed, already-shipped features
(ADR-0007, ADR-0010), closer in shape to ADR-0017's own "confirmation
pass, not a fresh full review" than to ADR-0007's original scrutiny.

**Why not skipped entirely**: this is the first exception ever carved into
team chat's "every message is a real, authenticated, rate-limited player"
invariant — the exact property ADR-0007's original review spent real time
on. A new discriminator on a highest-child-safety-risk table, plus a real
(if narrow) tightening of who can be tagged, both deserve independent
confirmation, not architect self-certification, matching this project's
standing practice for any new derived data or new write path touching
`TeamChatMessage`/`VideoClip`.

**Scoped review, focused specifically on** (mirroring ADR-0020's own
"scoped, not full weight" framing):

1. `authorType`/`systemEventType` are genuinely unreachable from any
   player-facing input — no DTO on `POST .../chat/messages` exposes
   either field, confirmed by reading the actual controller/DTO, not
   this ADR's claim about it.
2. `content` for a system row is genuinely fixed-template-only in the
   real implementation — no code path lets a caption or any other
   player-supplied string reach it.
3. The report/block "structural no" claims (Decision 3) hold against the
   actual query/guard code, the same "verify directly" bar this project
   applies everywhere (e.g. ADR-0017's security-reviewer pass traced the
   exact `findOne`/`leftJoin` calls rather than trusting the ADR's prose).
4. The new `teamJoinStatus === APPROVED` tightening on `taggedPlayerId`
   doesn't regress any existing legitimate flow (e.g. a captain tagging a
   just-joined, still-pending teammate as a light-touch "welcome"
   challenge — if that's a real pattern anyone actually uses, worth a
   quick check it isn't silently broken, though nothing in this app's
   existing design suggests it is).
5. The erasure-interaction claims in Decision 4 hold against the actual
   FK/migration state as implemented, not just as designed here.

## Consequences

- **Schema**: one new nullable column + partial index on `VideoClip`
  (`challenge_acknowledged_at`); two new columns on `TeamChatMessage`
  (`author_type`, `system_event_type`) — no new tables, no new entity
  name, so the naming-collision risk flagged in Context and by ADR-0005
  doesn't arise at the schema level.
- **Two new endpoints**: `GET .../clips/challenges/pending`,
  `POST .../clips/:clipId/challenge-ack`.
- **One tightened validation**: `taggedPlayerId` at `createUploadUrl` now
  also requires `teamJoinStatus === APPROVED` — closes a small,
  pre-existing gap this design surfaced, not a new restriction invented
  for its own sake.
- **`VideoClipsModule` gains a direct `TypeOrmModule.forFeature([TeamChatMessage])`**
  registration, purely to insert a system message without importing
  `TeamChatModule` back (avoiding a cycle) — the same technique
  `PlayersModule`/`WeeklyGoalModule` already use for an equivalent
  problem (ADR-0013 Decision 4).
- **The existing client-local `AsyncStorage`-based "seen challenge"
  tracking (`mobile/src/api/localFlags.ts`) is superseded and should be
  removed**, not kept alongside the new server-side field — a concrete,
  real fix to a per-device/reinstall data-loss bug this design enables,
  not just a nice-to-have.
- **Left open, not decided here**: per-viewer i18n of the system message's
  `content` (it's rendered once, server-side, in Swedish, at publish time
  — this app's ordinary human-authored chat text has never been localized
  either, so this isn't a new regression, but a future contributor could
  reasonably want a `systemEventType`-aware, client-side-rendered version
  using the same `t()`/param pattern the existing challenge toast already
  uses, for players on a non-Swedish locale per ADR-0014 — not built now).
  Also left open: whether a player should be able to prevent a specific
  teammate from tagging them at all (a `TeamChatBlock`-adjacent idea nobody
  has requested) — flagged, not designed, the same way ADR-0010 left the
  `TeamChatBlock`-vs-clip-visibility question open for a later ADR if a
  real need surfaces.
- **Hand-off**:
  - **ux-designer**: pending-challenges surface placement/visuals in the
    Laget (Team) tab (badge/counter + list), the exact ack-trigger
    interaction (auto-on-view vs. explicit dismiss), the chat
    system-message bubble's visual treatment (distinguishing it from an
    ordinary player message — no avatar/sender name the way a normal
    message has one), and the exact Swedish copy for the template
    sentence.
  - **backend-developer**: the two migrations, the two new endpoints, the
    `completeUpload` transaction change (publish + system-message insert
    together), the module-wiring fix (`VideoClipsModule`'s new
    `TypeOrmModule.forFeature`), the `teamJoinStatus` tightening, the
    report-rejection guard for system messages, and the
    `docs/api/phase2.6b-contract.md`/`phase3-contract.md` updates to match.
  - **frontend-developer**: the Team-tab pending-challenges badge/list,
    removal of the old `AsyncStorage`-based seen-tracking, and rendering
    the new system-message bubble distinctly in `ChatScreen.tsx`.
  - **security-reviewer**: the scoped confirmation pass in Decision 5,
    before backend-developer merges.
