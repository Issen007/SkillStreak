# 0013 - Self-service GDPR account erasure (Fas 4)

## Status

Accepted — 2026-07-29. Both decision points originally left open
(email-gates-the-clock, and `ClipReport` survival) were resolved by the
project owner the same day — see Open Questions below. A blocking
security-reviewer pass on 2026-07-29 found one confirmed blocking issue
and two further required-before-implementation issues, all closed by this
revision in place (Decisions 2, 4, 5, 6, 8 below) — see the callout at the
end of Consequences for what changed and why. **Blocking security-reviewer
re-confirmation still required before backend-developer/frontend-developer
build against this**, per CLAUDE.md's standing rule — this feature touches
auth (session/captaincy validity during a 30-day window), media
(hard-deleting video of a child), and the entirety of a child's account
data at once, i.e. all three of this project's standing blocking-review
triggers simultaneously, not just one.

## Context

The project owner, verbatim: *"The Erase function and support for GDPR so
if a person want to be deleted, you can delete your self in the app under
profile and delete all your content that you own. But also move over the
Captain part to another person in the team. If you are the last one in
the team the entire team should be delete. We should have a 30 days grace
period if a person regret it was deleted and confirm by email to be
deleted."*

This is a genuinely new feature area — no prior ADR, `BACKLOG`, or
`ACTION_PLAN` entry designs it — but it isn't a surprise gap.
`docs/adr/0010-video-storage-and-serving.md`'s "GDPR erasure of an entire
player account" section already named it explicitly: *"full account-level
erasure remains out of scope for this ADR... if/when a parent ever
requests deletion of an entire account, whoever performs it must remember
to hard-delete that player's VideoClip rows/objects as part of it... this
ADR doesn't build that script, but says plainly what it must do to that
data if/when it's built."* This ADR is that follow-up, now scoped to a
real self-service feature rather than a hypothetical admin script.

Three existing pieces of infrastructure this design deliberately extends
rather than reinvents:

- **`docs/adr/0012-profile-page-and-contact-email-change.md`**'s
  request → email-confirm → grace-period → cancel-by-mailed-link shape,
  at a longer timescale (30 days, not 24h) and much higher stakes
  (irreversible full data loss, not a revertible field swap).
- **`docs/adr/0006-captain-transfer.md`**'s captain-handoff philosophy —
  "the current captain hands off, self-service, no vote/election — a
  captain is just a flagged peer, not an authority above the other kids."
- **`ClipRetentionService`**'s scheduled-sweep shape (`@nestjs/schedule`,
  not new infra) for time-based execution, and its
  delete-object-before-row, leave-failures-for-next-run posture.

Surveyed against this codebase's actual entities (per
`docs/adr/0002-data-model.md` and a fresh read of every `*.entity.ts`),
"content you own" spans: `PlayerPrivateInfo`, `ParentalConsentRecord`,
`TrainingLogEntry`, `BadgeAward`, `VideoClip` (+ its MinIO object),
`ClipReport`, `TeamChatMessage`, `TeamChatBlock`, `TeamChatMessageReport`,
and `Challenge` (as `created_by_player_id`, the "veckans mål" a captain
authored). `Team` itself has never had a delete path. Three of these
tables currently have `ON DELETE RESTRICT` foreign keys back to `player`
specifically *because* no deletion feature existed yet
(`video_clip.uploader_player_id`, `team_chat_message.sender_player_id`,
`challenge.created_by_player_id` — each entity's own migration comment
says so verbatim). This ADR has to resolve all three, not just add a new
`DELETE FROM player`.

The individual-streak-vs-team-pool separation this codebase already
insists on (ADR-0002) matters here concretely: a departing player's own
`TrainingLogEntry` rows are personal behavioral history and should go: the
`TeamSeasonPot.points_total` they already contributed to is a **shared,
already-merged team total**, not attributable or clawable back per player
(it's incremented atomically at each log's insert, never recomputed from
the log rows) — deleting their history must not, and structurally cannot,
touch the team's pot.

## Decision — 1: a new `AccountErasureRequest` table, not columns on `Player`/`PlayerPrivateInfo`

Both precedents this ADR extends (session-reissue, contact-email-change)
put their pending-action state directly on the row the action governs.
That doesn't work here: **the whole point of this state is to outlive the
row it's about** — once erasure executes, `Player` is gone, so any
"was there a request, when, was it cancelled or executed" trail has to
live somewhere else from the start, not be reconstructed after the fact.
This is the one place in this feature that breaks from this codebase's
"boring, no new table for one row's transient state" default, and it's a
deliberate exception, not scope creep — the same reasoning ADR-0002 gives
`ParentalConsentRecord` its own table ("a single mutable status field
tells you the *current* state; this table proves *when and how* it
changed").

**Deliberately does NOT denormalize `screen_name`/`real_name`/any
identifying field onto this table.** Doing so to make the audit trail
"more useful" would quietly recreate the exact identifying-data-retention
problem the feature exists to solve — an erasure audit log that itself
becomes a permanent copy of the erased identity is a real, avoidable
failure mode, not a hypothetical one. `player_id`/`team_id`/
`successor_player_id` are kept as plain UUID columns (**no FK** — a real
FK back to `player`/`team` would force an `ON DELETE` choice that either
cascades this audit row away when the very thing it's auditing is deleted
(pointless) or blocks the deletion (wrong direction entirely) — an
orphaned UUID, meaningless on its own once the referenced row is gone, is
exactly the right amount of durability here, same category of "intentionally
soft reference" as `BadgeAward.awarded_by`'s `'system'` sentinel).

```
AccountErasureRequest
  id                          uuid, PK
  player_id                   uuid            -- no FK, see above
  team_id                     uuid            -- no FK, see above
  recipient_contact_snapshot  varchar, nullable -- encrypted (AES-256-GCM,
                                                    same utility as
                                                    PlayerPrivateInfo, ADR-
                                                    0011); resolved and
                                                    stored exactly once, at
                                                    request time; see
                                                    Decision 2's contact-
                                                    change-race fix
  successor_player_id         uuid, nullable  -- locked in at confirm time, see Decision 4
  status                      enum: requested / grace_period / cancelled / executed
  confirm_code                varchar, nullable, unique   -- single-use, nulled on use
  confirm_code_expires_at     timestamptz, nullable
  confirmed_at                timestamptz, nullable       -- grace-period clock start
  scheduled_for                timestamptz, nullable       -- confirmed_at + 30 days
  cancel_code                 varchar, nullable, unique   -- single-use, valid whole grace period
  cancelled_at                timestamptz, nullable
  executed_at                 timestamptz, nullable
  created_at                  timestamptz
```

Only one **active** (`requested`/`grace_period`) row per `player_id` at a
time — enforced the same way `idx_player_one_captain_per_team` enforces
its own single-active-row invariant: a partial unique index on
`player_id` `WHERE status IN ('requested', 'grace_period')`.

## Decision — 2: two separate emails — confirm-to-start-the-clock, and cancel-during-grace-period

**The project owner's original text was genuinely ambiguous between
"email confirmation is required to start the clock" and "email is purely
the regret/cancel mechanism, the clock starts on the in-app tap." Flagged
explicitly rather than silently picked — confirmed 2026-07-29 by the
project owner: the first option, below.**

Reasoning for that pick:

- This app has **no password**. Every consequential action so far is
  gated by nothing stronger than "holds a currently-valid session token."
  ADR-0012's own addendum found a real gap from exactly this: a
  momentarily-compromised or borrowed session (a sibling, a teammate
  handed the phone at practice — the same risk class already named
  elsewhere in this codebase) being enough, by itself, to complete a
  whole consequential flow with nothing to interrupt it. That addendum's
  fix for contact-email-change was a grace period the change doesn't take
  effect during; the same logic applies at least as strongly here, since
  this action is **irreversible total data loss**, not a revertible field
  swap.
- Requiring the in-app tap to only *start a request*, with the actual
  30-day clock gated on redeeming a code mailed to `parent_contact` (the
  same trust boundary session-reissue and contact-change already reuse:
  for an under-13 player, the real parent's inbox; for a 13+
  self-verified player, their own verified email), means a bare in-app tap
  from a borrowed/compromised session accomplishes nothing durable on its
  own — identical in shape to how a bare tap can't complete a contact-email
  change either.
- It also reads as the more literal match for *"confirm by email to be
  deleted"* — that phrase most naturally describes a required step, not an
  optional escape hatch.

**A second, separate email at confirm time** carries the grace-period
cancel link — mirroring ADR-0012's addendum exactly ("nothing concrete to
act on until the new-address code is actually redeemed... a new email...
at confirm time, not request time"). This is what actually implements
"30 days to regret it."

### Why not the cheaper alternative (skip the confirm-gate, in-app tap starts the clock immediately)

Genuinely defensible, and cheaper — one less code/email round-trip for an
action a real player will only ever take once. Rejected as the *default*
here specifically because of the password-less-session risk above, but
flagged, not dismissed — see Open Questions.

### The unsettled-contact-change interaction — closing a chained-hijack path (security-reviewer finding, 2026-07-29, blocking)

**Confirmed by reading the code**: `PlayerPrivateInfoService
.getParentContact()` calls `getEffective()`, which lazily applies any
*due* pending contact-change on the read itself (`isChangeDue()`/
`applyPendingContactChange()`). Both this feature's emails — the
confirm-code email at request time and the cancel-link email at confirm
time — resolve their recipient by calling `getParentContact()`. Chained
with ADR-0012's own already-accepted residual risk (a hijacked
`parent_contact` that the real family's old-address cancel-link didn't
stop in time simply becomes, after 24h, the sole live value, with nothing
left to distinguish it from a legitimate change) — a compromised session
that already won that race could, in the same sitting, immediately trigger
its *own* erasure request and have **both** the confirm code and the
day-30 cancel link land in the attacker's own inbox, with zero visibility
to the real family at any point in a 30-day, irreversible, whole-account
destruction. This is a materially worse outcome than the risk ADR-0012
already accepted (a redirected recovery channel) — full, family-invisible
data destruction, not just a redirected inbox.

**Fix: gate the erasure request on there being no unresolved contact-change
in flight, and snapshot the recipient once, never re-resolve it a second
time.**

1. Before creating the `AccountErasureRequest` row, check a new, narrow
   `PlayerPrivateInfoService.hasPendingContactChange(playerId)` — a
   **direct read of `pendingParentContact IS NOT NULL`**, deliberately
   *not* going through `getEffective()`, so the check itself can never
   trigger the very lazy-apply side effect it exists to catch ahead of.
   If a change is still in flight (whether still inside its own 24h
   window, or already past due but not yet lazily applied by some other
   read), the erasure request is refused outright:
   **`409 erasure_blocked_pending_contact_change`**. The caller must let
   that change either apply or be cancelled first, then request erasure
   again. `AccountErasureModule` imports `PlayerPrivateInfoModule`
   directly for this one narrow read — the same already-established
   pattern `ProfileModule` already uses, not a new exception to
   ADR-0002 addendum §1's "only this module may touch this table" rule.
2. Once cleared, `getParentContact()` is called **exactly once**, at
   request time (its own lazy-apply is safe here, precisely because step
   1 just confirmed there is nothing pending to spuriously apply), and the
   resolved value is stored — encrypted with the same AES-256-GCM utility
   `PlayerPrivateInfo` already uses (ADR-0011), not a new one — directly
   on `AccountErasureRequest.recipient_contact_snapshot` (Decision 1).
   **Both** the request-time confirm-code email and the confirm-time
   cancel-link email are sent to this single snapshotted value;
   `PlayerPrivateInfoService` is never queried again for the remainder of
   that request's lifecycle.

This closes the finding precisely: even if a contact-change (legitimate or
not) is initiated in the hours between request and confirm, it cannot
retarget where either erasure email goes, because there is no second read
left to retarget. It deliberately does **not** attempt to retroactively
detect or unwind an *already fully-applied* prior hijack — a
`pendingParentContact` that had already settled to `null` before this
feature was ever involved is indistinguishable from a legitimate change by
design, per ADR-0012's own accepted residual gap. That remains ADR-0012's
known, accepted risk; this ADR closes the *new* chained path this feature
would otherwise have opened, not the older, already-accepted one.

## Decision — 3: state machine and API surface

New module `backend/src/account-erasure/` (mirrors `profile/`'s reasoning
exactly: a distinct, narrow, security-relevant concern, not folded into
`PlayersModule`). All authenticated routes are `/players/me/...` — no
`:playerId` param, no IDOR surface, same posture as every other
self-service profile action.

```
POST /api/v1/players/me/erasure/request
  { successorPlayerId?: string }   -- required iff caller is captain AND
                                       has ≥1 teammate; forbidden otherwise
                                       (not-captain, or captain-but-last-
                                       player-on-team) — see Decision 4/5
  -> { requested: true, expiresAt }
  Refuses with 409 erasure_blocked_pending_contact_change if
  PlayerPrivateInfo has an unresolved pending contact-change in flight —
  see Decision 2's contact-change-race fix.
  Rate-limited (burst cooldown + daily cap), same RedisService pattern
  as session-reissue/contact-change (tryClaimErasureRequestCooldown /
  ...DailyCap) — the realistic abuse surface is "a compromised session
  spamming a family's inbox with a scary email," identical reasoning to
  the existing precedents, not a new threat model.
  Best-effort email to the request-time snapshot of parent_contact
  (Decision 2) with the confirm code — generated via the existing
  generateHumanCode (common/crypto/human-code.util.ts), the same single
  utility ADR-0012's contact-change flow already reuses, not a third
  bespoke generator — 24h TTL, longer than the 15-minute norm elsewhere in
  this app (session-reissue, contact-change) because this is a materially
  bigger decision than a single-sitting action; a family should be able to
  read it, think about it overnight, and come back, not be forced to act
  "right now."

GET  /api/v1/players/erasure-confirm/:code   -- unauthenticated preview,
                                                 no side effects (mirrors
                                                 ConsentController/
                                                 contact-change-cancel's
                                                 GET/POST split — email
                                                 clients/scanners prefetch
                                                 links)
POST /api/v1/players/erasure-confirm/:code   -- unauthenticated, the
                                                 actual action
  -> { confirmed: true, scheduledFor }
  Re-validates successorPlayerId (still on the team, not itself mid-
  erasure) if one was supplied; sets confirmed_at = now(),
  scheduled_for = confirmed_at + 30 days, status -> grace_period,
  generates cancel_code (valid the whole 30 days). Sends the distinct
  cancel-link email (Decision 2), to the same recipient_contact_snapshot
  the request-time email went to — never re-resolved from
  PlayerPrivateInfo. Does NOT flip is_captain yet — see Decision 4.

GET  /api/v1/players/me/erasure/status
  -> { status: 'none' | 'requested' | 'grace_period', scheduledFor? }
  Backs a persistent Profile-screen banner ("Ditt konto raderas den
  {date}. Ångra dig?") — ux-designer's call on copy/placement, not
  designed screen-by-screen here.

POST /api/v1/players/me/erasure/cancel        -- authenticated, PRIMARY
                                                  cancel path (see
                                                  Decision 6: the account
                                                  stays fully live during
                                                  the grace period, so an
                                                  in-app button is the
                                                  obvious low-friction
                                                  route, unlike ADR-0012's
                                                  24h flow which has none)
  -> { cancelled: true }

GET  /api/v1/players/erasure-cancel/:code      -- unauthenticated preview
POST /api/v1/players/erasure-cancel/:code      -- unauthenticated, the
                                                  mailed link's cancel
                                                  path — a backup for "I
                                                  don't have my session /
                                                  this is a new phone,"
                                                  not the primary route
  -> { cancelled: true } | null (already resolved — same friendly-no-op
                                  idiom as ConsentService.approve /
                                  ProfileService.cancelContactChange)
```

All four unauthenticated routes above (`erasure-confirm`/`erasure-cancel`,
both GET and POST) are throttled the same way ADR-0012's analogous
`contact-change-cancel` GET/POST pair already is (`@Throttle`, per-IP) —
the same defense-in-depth posture this codebase already applies to every
unauthenticated-by-necessity route, not a new one invented here.

Both cancel routes call the same internal
`AccountErasureService.cancel(playerId)` — no `token_version` bump on
either path (contrast with ADR-0012's cancel, which *does* bump it — see
Decision 6 for why that asymmetry is correct, not an oversight).

## Decision — 4: captain successor — named at confirm time, applied at execution time

Extends ADR-0006's philosophy directly: **the current captain names their
own successor, self-service, no vote/auto-pick as the default** — the
same reasoning that already ruled out "team-wide election" for ordinary
transfer rules out a silent "pick the longest-tenured teammate" here too;
both are the system deciding who leads instead of a peer.

Concretely:

- `successorPlayerId` is **required** in the initial request if the caller
  is currently captain and has at least one teammate — no optional
  fallback field, matching ADR-0006's "current captain chooses" framing
  exactly. If a UX affordance wants to *suggest* a default (e.g.
  pre-selecting the longest-tenured teammate in the picker, letting the
  requester confirm or change it), that's an ux-designer interaction-layer
  choice — the API itself never infers one server-side.
- The choice is **locked in at confirm time** (re-validated: still on the
  team, not itself mid-erasure) and stored on `AccountErasureRequest`, but
  the actual `Player.is_captain` flip is deferred to **execution time**,
  immediately before the requester's own `Player` row is deleted — reusing
  `PlayersService.transferCaptaincy`'s exact transaction, just invoked by
  the sweep job instead of an HTTP call from the captain.
- **Why defer the flip instead of doing it immediately at confirm time**
  (which was this ADR's first draft): keeping the requester as full,
  ordinary captain for the entire 30-day window — able to do every
  captain-gated action normally — is simpler and matches Decision 6's
  "nothing about the account is restricted during the grace period"
  posture. Flipping early would also create an awkward reversal question
  on cancel (does captaincy silently come back? does the new captain's
  interim actions get undone?) that deferring the flip avoids entirely:
  if they cancel, **nothing about captaincy ever changed**, full stop, no
  special-case undo logic needed.
- **The execution-time captain check is a live re-check, not scoped to
  one named scenario (security-reviewer finding, 2026-07-29)**: at
  execution, immediately before applying any flip, the check is simply
  "is this player captain *right now*," independent of what was true at
  request or confirm time. This deliberately covers more than "the named
  successor stopped being valid" — it also covers a **non-captain**
  requesting erasure correctly with no successor (none was required at
  the time), who then independently becomes captain afterward via an
  ordinary, unrelated `transferCaptaincy` call before their own execution
  date. Any time that live check reads `isCaptain: true` with no
  still-valid named successor, the auto-fallback below applies — the
  trigger is the flag's current state at the moment of execution, not
  which of the several possible ways it got there. Implementers must not
  special-case only the "team had no other players at request time but
  gained members later" scenario described below; that is one instance of
  this rule, not the whole rule.
- **`PlayersService.transferCaptaincy` (ADR-0006's existing endpoint,
  unchanged in every other respect) now also rejects a target with an
  active (`requested`/`grace_period`) `AccountErasureRequest`** — a new
  `CaptainTransferTargetMidErasureException` (`409`), checked inside the
  same row-locked transaction as the existing
  `newCaptainPlayerId === requesterId` check. Without this, a captain
  could hand off onto a teammate already mid-erasure themselves, only for
  that handoff to need immediate unwinding a moment later.
- **Module wiring**: `AccountErasureModule` already needs `PlayersModule`
  (to call `transferCaptaincy`/`findByIdForUpdate` at execution time), so
  `PlayersModule` cannot also import `AccountErasureModule` back to check
  the `account_erasure_request` table without a module cycle. Resolved
  the same way `WeeklyGoalModule` already avoids an equivalent cycle with
  `TrainingLogsModule`: `PlayersModule` registers `AccountErasureRequest`
  via its **own** `TypeOrmModule.forFeature([AccountErasureRequest])` and
  queries it as a plain repository lookup directly inside
  `PlayersService` — not a service-to-service call into
  `AccountErasureService`. Both the `transferCaptaincy` rejection above
  and the auto-fallback candidate query below use this same repository.
- **The auto-fallback candidate query (longest-tenured remaining
  teammate) excludes anyone who currently holds an active
  `AccountErasureRequest` themselves (security-reviewer finding,
  2026-07-29)** — without this, a same-sweep-run auto-pick could crown
  someone captain moments before their own row is deleted later in the
  identical run, since neither this sweep nor `ClipRetentionService`
  (which it mirrors) guarantees any row-processing order. The
  zero-remaining-candidates case this exclusion can create (every
  teammate, including the requester, erasing in the same run) is handled
  by Decision 5's batching, not as a separate special case here.
- **If the requester cancels, no captaincy consequence at all** (see
  above) — worth calling out because it's the one place this design might
  surprise someone: naming a successor during the request does not "use
  it up" or partially apply anything unless execution actually happens.

## Decision — 5: last-player-deletes-team — batched per team within a sweep run

Checked **fresh at execution time**, not at request/confirm time — the
roster can change over 30 days (other players separately requesting and
completing their own erasure, new joins via invite code), so "am I the
last one" is only meaningful as of the moment it actually matters.

**Refined per a security-reviewer finding (2026-07-29): "last one" has to
account for other players *from the same team* whose erasure is executing
in this exact same sweep run, not just the team's currently-stored player
count.** Three players on one team, all past their `scheduled_for` on the
same day, processed one row at a time with no ordering guarantee (the same
posture `ClipRetentionService` already has, deliberately not strengthened
here either) could otherwise each individually see "2 other players still
on the roster" and skip the team-cascade path entirely — or worse, have a
captain auto-fallback try to crown one of the other two, who is also being
deleted in the same run.

**Fix: `AccountErasureSweepService` groups this run's due rows by
`team_id` before processing any of them.** For each team with at least one
due row:

1. Compute `survivingCount` = that team's current roster size minus the
   number of that team's players in *this run's* due-row batch (not minus
   one — minus however many of the team are being executed together).
2. **If `survivingCount === 0`** (every remaining player on the team is
   being executed in this same run — including, trivially, the ordinary
   single-player case): treat the **entire batch** as the last-player path
   below, once, for the team as a whole — not per individual row. A
   captain auto-fallback is never attempted for any row in this batch,
   since there is nobody left to hand off to.
3. **If `survivingCount > 0`**: process each of that team's batch rows
   individually per Decision 6, and — this is what closes the
   zero-candidates half of Decision 4's auto-fallback — draw any needed
   captain auto-fallback candidate *only* from the surviving set (current
   roster minus this entire batch), never from another player in the same
   batch. Because that pool is defined as "the team minus everyone
   erasing this run," it is never accidentally empty while
   `survivingCount > 0`, and row-processing order within the batch no
   longer matters for this purpose.

**Mechanism for the `survivingCount === 0` case, unchanged from the
original design**: because every team-scoped table's FK ultimately roots
at either `team_id` or (transitively) `player_id`, and `player.team_id` is
itself `ON DELETE CASCADE` from `team`, deleting the whole batch reduces
to one clean cascading operation, not a manual per-entity/per-row walk:

1. **Enumerate and hard-delete every `VideoClip` object for the team from
   MinIO first** (`ObjectStorageService.deleteObjectIfExists`, same
   delete-if-exists posture `ClipRetentionService` already uses) —
   **Postgres cascade can never reach object storage**, so this step is
   not optional and cannot be replaced by the DB cascade below no matter
   how the FKs are configured.
2. `DELETE FROM team WHERE id = :teamId`. Cascades, in order, to: `Season`,
   `TeamSeasonPot`, `Challenge` (via `team_id`), `TeamChatMessage` (via
   `team_id`), `VideoClip` rows (objects already purged in step 1), and
   `Player` (via `team_id` CASCADE, covering every player in the batch at
   once — not one `DELETE` per row) — which itself further cascades to
   `PlayerPrivateInfo`, `ParentalConsentRecord`, `BadgeAward`,
   `TrainingLogEntry`, `TeamChatBlock`, `ClipReport`,
   `TeamChatMessageReport`. One statement, inside one transaction,
   correctly tears down everything scoped to that team with no bespoke
   per-entity or per-row delete calls beyond the MinIO purge.
3. If a requester **cancels** during the grace period before their
   `scheduled_for`, their row simply never enters a future run's batch —
   the team continues exactly as before, same as any other cancellation.

## Decision — 6: per-entity rules for "content you own" (non-last-player case)

When the team continues, `Player` cannot simply cascade-delete the way it
does in Decision 5, because three tables currently `RESTRICT` that
deletion by design (each one's own migration comment says so: "no
player-deletion feature exists yet"). This ADR is what makes that
deletion exist, so each of those three needs a real, deliberate answer —
not just a schema loosen.

| Entity | Treatment | Why |
|---|---|---|
| `PlayerPrivateInfo` (`real_name`, `parent_contact`, both AES-256-GCM per ADR-0011) | **Hard-delete** (already `ON DELETE CASCADE`) | The actual sensitive PII this table exists to isolate — no legitimate reason to retain it once its subject is gone. |
| `ParentalConsentRecord` | **Hard-delete** (already `ON DELETE CASCADE`) | It's the audit trail *for this player's own consent history*; deleting the account is deleting the processing it authorized. `AccountErasureRequest` (Decision 1) is the durable proof "erasure was requested and completed on this date" — this table doesn't need to separately survive to serve that purpose. |
| `TrainingLogEntry` | **Hard-delete** (already `ON DELETE CASCADE`) | Personal behavioral history. **Does not touch `TeamSeasonPot.points_total`** — see Context; the pot is an already-merged, non-attributable running total, never recomputed from log rows. |
| `BadgeAward` | **Hard-delete** (already `ON DELETE CASCADE`) | Personal achievement data, no other party's interest in it. |
| `VideoClip` (uploaded by them) | **Hard-delete: MinIO object first, then the row** — reuses the exact mechanism behind the existing self-service `DELETE .../clips/:clipId` (ADR-0010) | The video itself, not just metadata, is the personal data (a child's face/voice) — no anonymize-in-place option is meaningful here. `taggedPlayerId` references *on other players'* clips are unaffected (already `ON DELETE SET NULL`, no change needed). |
| `Challenge.created_by_player_id` (a goal they authored as captain) | **Anonymize: FK changes `RESTRICT` → `SET NULL`, column becomes nullable; row itself is kept** | This is shared team-level state — a weekly goal other teammates already earned bonus points from (`goal_bonus_points_awarded`). It is not solely "their content" the way a chat message or a video is; deleting the row would erase a real piece of team history for everyone else. Mirrors `VideoClip.taggedPlayerId`'s already-established "detach the identity, keep the row" pattern. |
| `TeamChatMessage` (sent by them) | **Anonymize, don't hard-delete: `sender_player_id` FK changes `RESTRICT`+not-null → `SET NULL`+nullable; `content` is overwritten with a fixed placeholder at erasure time; row and `createdAt`/ordering are kept** | Preserves the remaining team's shared conversation continuity (no gaps in a flat, non-threaded feed) and, not incidentally, means `TeamChatMessageReport` rows referencing this message need **no** FK change at all — the message row still exists, just anonymized, so any pending moderation report against it stays fully intact by construction. **This is a deliberate, narrow, documented exception to ADR-0007's stated "send-once, never mutated" invariant, scoped only to this erasure execution path** — not a general edit capability, and worth an explicit security-reviewer confirmation that no other code path can trigger this mutation. |
| `TeamChatBlock` (either direction) | **Hard-delete** (already `ON DELETE CASCADE`, both `blocker_player_id`/`blocked_player_id`) | Personal moderation preference data, no accountability weight. |
| `ClipReport` (`reporter_player_id`) | **Hard-delete** (already `ON DELETE CASCADE`) | Their own filed report — their own action, fine to remove with the rest of their content. |
| `ClipReport` (`reported_uploader_player_id` — i.e. reports made *about* them by someone else) | **Anonymize: FK changes `CASCADE` → `SET NULL`, column becomes nullable; row itself is kept** — **decided by the project owner 2026-07-29, see Open Questions** | This is not "their content" to delete; it's someone else's accountability record about them. Mirrors `clip_id`'s own already-established "outlive the thing it reported" pattern — a report can't be self-erased by the person it's about. |
| Redis: per-team streak leaderboard (sorted set) | **Explicit `ZREM` of this player's member at execution time** | Sorted-set entries don't expire on their own; leaving one behind after deletion would show teammates a frozen "ghost" score indefinitely, until someone happens to run a full Redis rebuild. Every other Redis key touching this player (rate-limit/cooldown claims) is left alone — harmless, they expire on their own short TTLs regardless. |
| Session validity | **No new mechanism needed** — `JwtAuthGuard` already does a live Postgres lookup of `tokenVersion` on every request and already treats "no such player" the same as a version mismatch (confirmed by reading the guard directly). Once the row is gone, every existing token for that player stops working on its own, immediately. | |

Execution order (inside one transaction, so a partial failure never
leaves the row half-deleted): purge `VideoClip` objects from MinIO first
(idempotent, delete-if-exists — safe to retry), then in a single
`dataSource.transaction`: anonymize `TeamChatMessage` rows, null
`Challenge.created_by_player_id` rows, delete `VideoClip` rows, apply the
deferred captain flip if applicable (Decision 4), `DELETE FROM player`
(cascading the rest per the table above), then `ZREM` the leaderboard
entry. If the transaction fails partway, nothing commits, `scheduled_for`
stays in the past, and the next day's sweep simply retries the whole
thing — safe, because every step is either idempotent or inside the same
all-or-nothing transaction.

**The `TeamChatMessage` content-anonymizing `UPDATE` lives only inside
`AccountErasureService`'s own execution transaction** (security-reviewer
note, 2026-07-29) — it must never be exposed as a general-purpose
repository method callable from anywhere else in this codebase. There is
no DB-level guard preventing misuse of such a method if one existed; the
actual protection is simply not writing one anywhere reusable, the same
discipline this codebase already relies on elsewhere (e.g. `storage_key`
never being client-suppliable is enforced by never accepting it as input,
not by a constraint).

## Decision — 7: fully live account during the grace period; in-app cancel is primary, mailed link is a backup

**Nothing about the account is restricted during the 30 days.** No
read-only mode, no visible "pending deletion" gate on gameplay — a kid who
might regret this shouldn't have their last month of streaks/team
participation crippled while they decide, and this app has no
infrastructure for a meaningful partial-lockout state anyway. The
Profile-screen banner (Decision 3's `GET .../erasure/status`) is the
*visibility* mechanism; it is not an enforcement mechanism.

**In-app cancel (`POST .../erasure/cancel`) is the primary path, not an
afterthought** — unlike ADR-0012's 24h contact-change flow (which has
*no* in-app cancel by design, only the mailed link), the account here
stays fully live and reachable for the entire 30 days, so requiring a mail
round-trip to undo a same-session decision would be needless friction.
The mailed cancel link exists as a backup for "I don't have this device/
session anymore."

**Neither cancel path bumps `token_version`, unlike ADR-0012's
cancel-by-old-address.** That asymmetry is deliberate, not a gap: ADR-0012's
cancel exists because the confirm-code and the cancel-link go to
*different, potentially adversarial* parties (an attacker-controlled new
address vs. the legitimate old address) — forcing a fresh login is
warranted because a hijacker might still hold the live session. Here, the
confirm email and the cancel email go to the **same** snapshotted address
(Decision 2), in the **same** flow, with no attacker-controlled alternate
destination anywhere in the sequence — there's no adversarial party for a
token bump to protect against.

## Decision — 8: scheduled sweep, mirroring `ClipRetentionService`

New `AccountErasureSweepService`, `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)`
(daily is plenty granular for a 30-day window — no need for the hourly
cadence the video-upload abandoned-TTL sweep needed). Finds
`AccountErasureRequest` rows where `status = 'grace_period' AND
scheduled_for <= now()`, **groups them by `team_id` before processing any
of them** (Decision 5's refinement), and executes each team's batch per
Decision 5/6 — same per-row-turned-per-batch try/catch/leave-for-next-run
posture as `ClipRetentionService`: a failure on one team's batch is
logged and retried the next day, never blocks another team's batch in the
same run. Inherits the existing `replicas: 1` single-runner constraint
already documented (`k8s/README.md`) for the other two sweeps in this
codebase; if the API is ever scaled beyond one replica, this needs the
same kind of guard that gap already requires solving, not a new problem
invented here.

## Migrations needed

- New table `account_erasure_request` (Decision 1), including the
  `recipient_contact_snapshot` column (encrypted, same AES-256-GCM utility
  as `PlayerPrivateInfo`, ADR-0011 — see Decision 2's contact-change-race
  fix) and the partial unique index on `player_id WHERE status IN
  ('requested', 'grace_period')`.
- `challenge.created_by_player_id`: drop the `RESTRICT` FK, add it back
  `ON DELETE SET NULL`, column becomes nullable.
- `team_chat_message.sender_player_id`: drop the `RESTRICT` FK, add it
  back `ON DELETE SET NULL`, column becomes nullable.
- `video_clip.uploader_player_id`: drop the `RESTRICT` FK, add it back
  `ON DELETE CASCADE` — a **backstop only**, since the actual MinIO object
  deletion must happen explicitly in application code regardless of how
  this FK is configured (Postgres cascade never reaches object storage);
  this just guarantees the row can't get stuck `RESTRICT`-blocked if the
  app-level walk ever misses one.
- `clip_report.reported_uploader_player_id`: drop the `CASCADE` FK, add it
  back `ON DELETE SET NULL`, column becomes nullable — per the project
  owner's 2026-07-29 decision (Open Questions #2), so a safety report
  outlives the account it was filed against.
- No change to `parental_consent_record`/`player_private_info`/
  `training_log_entry`/`badge_award`/`team_chat_block`/`clip_report`
  (`reporter_player_id`) — all already `CASCADE`, all confirmed correct
  above.
- No schema change is needed for the Decision 4 fixes (the
  `transferCaptaincy` mid-erasure rejection, or the auto-fallback
  exclusion) — both are new application-level queries against the
  already-defined `account_erasure_request` table, wired into
  `PlayersModule` via its own `TypeOrmModule.forFeature` (see Decision 4's
  "Module wiring"), plus one new `CaptainTransferTargetMidErasureException`
  following this codebase's existing `AppException` pattern exactly.

## Consequences

- Three existing `RESTRICT` foreign keys, each added specifically because
  "no player-deletion feature exists yet," now have real, considered
  answers instead of just being loosened.
- `TeamChatMessage` gains its first-ever mutation path (content
  overwritten at erasure time), a narrow, explicitly scoped exception to
  ADR-0007's "send-once, never mutated" invariant — flagged for
  security-reviewer to confirm nothing else can reach this path.
- `Challenge` and `VideoClip.taggedPlayerId` share one established
  "detach identity, keep the row" pattern now used in two places instead
  of one.
- `TeamSeasonPot.points_total` is provably untouched by any deletion this
  ADR performs — the individual-streak-vs-team-pool separation this
  codebase insists on holds under erasure exactly as it does everywhere
  else.
- One new table, no changes to `PlayerPrivateInfo`'s existing encryption
  boundary (ADR-0011) beyond reusing its utility for one new column —
  erasure otherwise just deletes the whole `PlayerPrivateInfo` row, it
  doesn't need to reason about its own encrypted fields specially.
- `PlayersModule` gains a direct `TypeOrmModule.forFeature([AccountErasureRequest])`
  registration purely to query that table without importing
  `AccountErasureModule` back (Decision 4) — the same "register the
  entity directly, not the whole owning module" technique
  `WeeklyGoalModule` already uses to avoid an equivalent cycle with
  `TrainingLogsModule`; not a new architectural pattern for this codebase.
- Real, novel tension surfaced, not resolved here (see Open Questions):
  a player currently under active moderation report
  (`TeamChatMessageReport`) can, today, close their own account while that
  report is still open. This app has no admin/moderation-review workflow
  to hook a "hold" into even if one were wanted — worth a decision, not an
  oversight.
- **Security-reviewer's 2026-07-29 blocking pass, and what changed as a
  result**: one confirmed blocking finding (the chained contact-change/
  erasure hijack path — Decision 2's new subsection, plus the new
  `recipient_contact_snapshot` column) and two further
  required-before-implementation findings (Decision 4's execution-time
  captain-check reframing, `transferCaptaincy`'s new mid-erasure
  rejection, and the auto-fallback exclusion query; Decision 5's
  team-batched sweep processing to close the zero-candidates/ordering gap)
  are all closed in place above. Two minor/advisory notes were folded in
  as small explicit additions (Decision 6's note that the chat-anonymizing
  `UPDATE` is transaction-local only; Decision 3's explicit throttle and
  code-generation-utility callouts). Everything else in that review came
  back clean and required no change: the Decision 5 cascade-delete claim
  was verified line-by-line against the actual migrations, `JwtAuthGuard`'s
  session-invalidation-on-delete claim was confirmed correct by reading the
  guard directly, and no inconsistency was found between Decision 2/6/
  Migrations/Open Questions on the two points the project owner had
  already resolved.

## Open questions for the project owner

1. ~~**Confirm-email-gates-the-clock vs. confirm-email-is-cancel-only**~~
   **Resolved 2026-07-29 by the project owner: email-gates-the-clock**,
   this ADR's default (Decision 2) — the in-app tap only starts a
   request, and the 30-day clock doesn't begin until the emailed code is
   redeemed, mirroring ADR-0012's grace-period redesign and closing the
   same "compromised/borrowed session" gap that redesign found.
2. ~~**Should `ClipReport.reported_uploader_player_id` survive the
   reported player's own account deletion?**~~ **Resolved 2026-07-29 by
   the project owner: yes** — changed to nullable + `ON DELETE SET NULL`
   (Decision 6, Migrations needed), mirroring `clip_id`'s own
   already-established "outlive the thing it reported" pattern, so a
   genuine safety report can't be self-erased by the person it's about.
3. **Should erasure execution pause/delay if the requester has an
   unresolved report against them at sweep time?** This app has no
   moderation/admin-review workflow at all today (reports are
   append-only, surfaced to nobody per ADR-0007/0010's own design) — so
   there is nothing for a "hold" to actually check today even if wanted.
   Flagged as a real gap this feature exposes, not designed here.
4. **Reminder emails during the 30-day window** (e.g. a day-15 nudge) so
   a busy parent who misses the single cancel email doesn't lose the
   chance to regret it — not requested by the project owner, a plausible
   nice-to-have, not designed here (same "flag, don't silently build or
   drop" posture ADR-0006 used for captain-transfer notifications).
