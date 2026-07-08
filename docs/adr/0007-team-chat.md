# 0007 - Team chat (Fas 2.6b)

## Status

Accepted — 2026-07-08. **Blocking security-reviewer sign-off required before
merge**, per CLAUDE.md's standing rule for anything touching child data —
this is the highest child-safety-risk feature built in this app so far
(real freeform text between children, with no adult account reachable
in-app), and this ADR says so explicitly rather than treating the
filter/report/block combination below as a complete answer.

## Context

`docs/ACTION_PLAN.md`'s Fas 2.6b: a team chat so players "can communicate
with each other... and also... communicate with the capten," described as
"a way to help each other continue their streak." Confirmed product
decisions from the project owner (not re-litigated here):

- Freeform text, **team-scoped only** — never cross-team, per CLAUDE.md's
  closed-team-bubble constraint.
- A keyword/profanity filter on send.
- A per-message **report** action and a **block(-sender)** action.
- A future LLM-based moderation layer is explicitly deferred
  (`docs/BACKLOG.md`, "Team Chat — LLM-based Moderation") — not designed
  here, but today's design must not foreclose it.

This is the first feature in this app where children exchange truly
freeform content with each other in real time. Every other Phase 1-2
surface is either structured (a training log, a weekly goal, screen names)
or constrained (`BadgeAward.context`'s discriminated union). There is no
coach login (ADR-0004's addendum) and no adult account of any kind
reachable synchronously in this app (ADR-0005's pivot) — so "who moderates
this" cannot be answered with "the coach reviews it in their dashboard," and
this ADR is explicit throughout about where that leaves a real, unclosed
gap rather than asserting the design below fully solves moderation.

## Decision — 1: message model, team-scoped by construction

**`TeamChatMessage`** (Postgres — durable, audit-relevant history, not a
cache; same posture ADR-0002 gives `TrainingLogEntry`):

```
TeamChatMessage
  id                  uuid, PK
  team_id             uuid, FK -> team.id           -- denormalized, same
                                                          reasoning as
                                                          TrainingLogEntry.team_id:
                                                          every read is
                                                          team-scoped, so this
                                                          field means that scoping
                                                          never requires a join
                                                          out to Player.
  sender_player_id    uuid, FK -> player.id, ON DELETE RESTRICT
                                                       -- same precedent as
                                                          Challenge.created_by_player_id:
                                                          don't silently orphan a
                                                          message by deleting a
                                                          player who doesn't
                                                          exist as a deletable
                                                          entity yet anyway.
  content             varchar(500), not null           -- the message exactly
                                                          as sent; see Decision 2
                                                          for why this is never
                                                          mutated/redacted.
  status              enum('visible','hidden'), default 'visible'
                                                       -- see Decision 3: 'hidden'
                                                          is set only by an
                                                          out-of-band admin
                                                          action, never by any
                                                          in-app endpoint.
  created_at          timestamptz, default now()
```

Indexed on `(team_id, created_at)` for the poll query below. No
`updated_at`/edit history — messages are send-once, not editable, matching
the "reject with a clear error, don't silently mutate" rule from Decision 2
(there's nothing to edit after the fact; get it right before sending or
send a follow-up message).

**`TeamChatBlock`** (per-viewer mute, Decision 4):

```
TeamChatBlock
  id                  uuid, PK
  blocker_player_id   uuid, FK -> player.id
  blocked_player_id   uuid, FK -> player.id
  created_at          timestamptz, default now()
  UNIQUE (blocker_player_id, blocked_player_id)
```

**`TeamChatMessageReport`** (append-only audit trail, Decision 3 — same
rationale ADR-0002 gives `ParentalConsentRecord`: this is the one place in
the feature with real accountability weight, so it's a separate, append-
only table, never mutated):

```
TeamChatMessageReport
  id                  uuid, PK
  message_id          uuid, FK -> team_chat_message.id
  reporter_player_id  uuid, FK -> player.id
  reason              enum('bullying','inappropriate_language','spam','other')
  note                varchar(140), nullable            -- capped, same pattern
                                                            as BadgeAwardContext's
                                                            human-authored `note`
  created_at          timestamptz, default now()
  UNIQUE (message_id, reporter_player_id)                -- one report per
                                                            (message, reporter);
                                                            see Decision 3.
```

**No response, anywhere, ever returns `TeamChatMessageReport` rows to any
player** — not to the reported player, not to the team, not even a count.
Only a `reportedByMe: boolean` derived per-viewer on the message list (so a
client can disable/relabel an already-used "report" button) is ever
surfaced. This protects the reporter's anonymity from the reported player —
a real retaliation-prevention concern in a peer group with no adult
mediating it, and worth stating as a deliberate boundary, not an oversight.

## Decision — 2: keyword filter, pluggable, reject-don't-mutate

**A synchronous check on send, behind a one-method interface, so a future
async/LLM classifier can replace or augment it without changing the send
pipeline's shape:**

```ts
interface ChatModerationResult {
  allowed: boolean;
}

interface ChatModerationCheck {
  check(content: string): Promise<ChatModerationResult>;
}
```

`TeamChatService.postMessage` depends on `ChatModerationCheck` via a DI
token (`CHAT_MODERATION_CHECK`), not a concrete class — swapping the
keyword implementation for an LLM-backed one later (per
`docs/BACKLOG.md`'s deferred item) is a provider binding change, not a
rewrite of the send path. This is the concrete answer to the task's
instruction not to hardcode the filter check in a way an async classifier
couldn't later slot into the same pipeline: the interface is already
`Promise`-returning even though today's implementation is synchronous
under the hood, specifically so an eventual network call to a
classification service is a drop-in, not a refactor.

`KeywordChatModerationCheck` (the Phase 2.6b implementation): a maintained
Swedish wordlist — a plain, reviewable data file
(`backend/src/team-chat/swedish-filter-wordlist.json`), not a database
table, matching this project's existing "badge catalog is seeded data, not
user-generated" posture for a small, slow-changing list. A DB-backed,
admin-editable wordlist is a reasonable later upgrade if the static file
becomes painful to maintain — not built now, since there's no admin
surface to edit it from anyway (same "boring for the current phase"
reasoning CLAUDE.md asks for). Matching is case-insensitive,
word-boundary-aware (to avoid flagging an innocent word that merely
contains a banned substring), and normalizes trivial evasion (repeated
characters, inserted spaces/punctuation between letters of a flagged word)
— kids attempting to route around a keyword filter on the first day is the
expected case to design for, not an edge case.

**On a match: reject the send outright.**
`422 message_rejected_by_filter` (a dedicated error, not a `400` reused from
elsewhere, since this is a content-policy rejection, not a shape/validation
failure), with generic, non-judgmental copy ("Ditt meddelande innehåller
ord som inte är tillåtna. Skriv om det.", exact wording ux-designer's call).
**The message is never partially redacted, censored-and-sent, or silently
altered** — it either sends as written or doesn't send at all, so the
sender always knows exactly what their teammates will see. This is the
task's explicit instruction and also the simpler implementation: no
"here's what actually got stored vs. what you typed" discrepancy to reason
about later.

Known, accepted limitation of any keyword filter (stated plainly, not
glossed over): it catches banned *words*, not bullying/grooming *patterns*
expressed in clean language — exactly the gap `docs/BACKLOG.md`'s deferred
LLM-moderation item exists to close later, not this ADR.

## Decision — 3: reporting — what happens, and the honest answer on "who reviews it"

**Reporting never changes a message's visibility.** `status` only ever
becomes `'hidden'` via a direct, out-of-band administrative action (a
backend-developer script or a manual update, in the same posture Phase 1-2
already use for team/invite-code creation, coach-account creation, and the
original captain assignment — "seed/admin action, not an in-app feature," a
pattern this codebase already relies on repeatedly for exactly the class of
action that needs real authority and doesn't have an in-app role to hold
it). **No in-app actor — not the reporter, not the reported player, and
explicitly not the captain — can hide a message team-wide.**

### Why not auto-hide on report (including "hide after N reports")

A single peer's report silently removing content for the entire team hands
that one child real censorship power over a teammate's speech — a bigger
authority than anything else in this app grants a peer (roster viewing and
consent-reminder/session-reissue triggers are logistics, not content
control). A report-count threshold (e.g. "hide after 2 distinct reporters")
was considered and rejected for the same reason at a smaller scale: in a
team of a "handful" of players, 2 reports is already a large fraction of
the roster, and a threshold invites exactly the coordinated-pile-on failure
mode it's meant to prevent, with no reviewer able to reverse a bad call.

**A captain-triggered team-wide hide was also considered and explicitly
rejected**, for consistency with this task's own framing of captaincy
elsewhere: "a captain is just a flagged peer, not an authority above the
other kids." Letting a captain unilaterally suppress a teammate's message is
a materially bigger authority than transferring their own role (ADR-0006)
or nudging a teammate's parent (ADR-0005) — it's authority *over another
player's content*, which nothing else in this app grants a peer, and
granting it here would be inconsistent with the trust model this whole
phase is built on, not a small extension of it.

### What reporting actually does

1. Persists the `TeamChatMessageReport` row (the audit trail — this is
   real, even though nothing currently consumes it automatically).
2. **Best-effort, rate-limited email notification to two destinations**,
   reusing the existing `MailService`/"best-effort mail send" pattern
   (`backend/README.md`'s documented pattern: the DB write always succeeds
   independently; the email send is a try/catch afterward that only logs on
   failure, same as `ConsentService.sendReminderEmailBestEffort`):
   - **The reported player's own parent** (`parent_contact`, read via
     `PlayerPrivateInfoService.getParentContact` — see the module-boundary
     note below) — the direct accountability chain for that specific
     child's own behavior.
   - **The team's coach, if one is on file** (`Coach.email`, looked up via
     the *dormant* `TeamCoach` join — ADR-0004's addendum explicitly kept
     this schema in place, unused, "a real adult-coach login is plausible
     again in a later phase"; this reuses only the stored email address,
     nothing about coach login/auth is reactivated). This is the closest
     thing to "the adult who actually knows this team in real life," even
     though there's no in-app mechanism for that person to act on it.
   - Both emails are **rate-limited to at most one per reported player per
     rolling 24 hours**, aggregating multiple reports in that window into a
     single email — a Redis cooldown key exactly like
     `RedisService`'s existing `consentReminderCooldownKey` pattern, chosen
     deliberately *because* the Phase 2.5 security review already found the
     consent-reminder cooldown only bounded a 5-minute burst, not sustained
     volume, and flagged it as a real harassment vector (an authenticated
     captain forcing an email every 5 minutes indefinitely). This feature
     starts with the daily-cap version of that fix already applied, rather
     than repeating the same finding a second time.
   - A report itself is also rate-limited per reporting player (a send-side
     cooldown, same shape) so mass-reporting can't be used as a harassment
     tool against the target in its own right.
   - `(message_id, reporter_player_id)` is unique — a second report of the
     same message by the same player is `409
     chat_message_already_reported_by_you`, not a fresh row, so repeated
     reporting can't inflate anything (there is no threshold to inflate by
     design, but the uniqueness constraint is cheap and forecloses a future
     contributor building a threshold feature on an uncapped count later
     without noticing this).

### The gap this does not close — stated plainly, per the task's instruction

**There is no reliable, timely review path between a report being filed and
any human noticing or acting on it.** The two emails above are a real,
concrete improvement over nothing, but both depend on a human (a specific
parent, or a coach whose email may be stale/unmonitored — Phase 1 never
built coach account self-serve, so a seeded `Coach.email` may not even be a
real, checked inbox) reading an email and then acting entirely out-of-band
(a real-world conversation, or asking whoever has database/script access to
flip a message's `status` to `hidden`). **There is no in-app appeal, no
guaranteed response time, and no way for the reporting player — the person
who may actually be harmed — to get faster relief than "block this
sender for myself" (Decision 4).** This residual risk is real, not
theoretical, and is the single most important thing for security-reviewer
to weigh explicitly before this feature ships: is "two best-effort emails,
rate-limited, plus a personal block button, plus an out-of-band admin
hide-switch" an acceptable moderation posture for real children's freeform
messages at this project's current beta scale, or does Fas 2.6b need to
wait for a faster-than-email path? This ADR does not resolve that
question — it surfaces it, per the task's explicit instruction not to paper
over it.

### Module-boundary note — extends ADR-0002's addendum §1

`PlayerPrivateInfoService.getParentContact` was scoped, per ADR-0002's
2026-07-03 addendum, to exactly one legitimate caller ("the consent-flow
service"). This ADR adds a **second** legitimate caller: the new
`team-chat/` module, for the narrow purpose above. This is a deliberate,
explicit widening of that boundary, not an oversight — the call is still
narrow (one player's contact, on a real report event, never a bulk/
leaderboard-shaped read), so it doesn't violate the *spirit* of the
original rule, but it is a second module now depending on
`PlayerPrivateInfoModule`, which security-reviewer should confirm is still
an acceptable shape (e.g. that `team-chat/` can't reach `real_name` or any
other field through this path — it can't, `getParentContact` only ever
returns `parent_contact`, but worth confirming directly rather than
assuming).

## Decision — 4: block is per-viewer, never team-wide

**`POST /api/v1/teams/:teamId/chat/blocks { blockedPlayerId }`** — the
requester mutes `blockedPlayerId`'s messages in their **own** view only.
`DELETE .../chat/blocks/:blockedPlayerId` reverses it. Blocking is
**idempotent** (blocking an already-blocked player is a `200` no-op, not an
error) — unlike reporting, a repeat block carries no signal worth
protecting against inflation of; it's a personal preference toggle, not an
accusation.

### Why per-viewer, not team-wide

A team-wide block would let one player unilaterally silence another for
everyone — exactly the same "bigger authority than a peer should have"
problem Decision 3 already rejects for message-hiding, applied to a whole
sender rather than one message. Per-viewer blocking gives every child a
real, immediate personal remedy ("I don't want to see this person's
messages") with zero effect on anyone else's view, and needs no
authorization check beyond ordinary team membership (you can only block a
teammate, not an arbitrary player id — `assertTeamMembership` on the
target).

**Blocking is silent**: the blocked player is never notified, and no
response anywhere reveals who has blocked them — matching ordinary
consumer-app convention (Snapchat/Instagram-style silent blocking) and
reducing retaliation risk, the same reasoning behind report-anonymity in
Decision 1.

Enforced **server-side**, in the message-list query itself (a `NOT EXISTS`
against `TeamChatBlock` scoped to the viewer), not a client-side filter —
so a blocked sender's messages are never present in the response at all,
not merely hidden by the UI (which a modified client could trivially
bypass).

## Decision — 5: fetch is poll-based, not real-time push — a deliberate, boring choice

**`GET /api/v1/teams/:teamId/chat/messages?after=<ISO timestamp>&limit=<n>`**,
player auth + team membership only (no captain gate — every player,
including the captain, is an equal participant in one shared channel; this
directly matches the ACTION_PLAN wording "communicate with each other...
and also communicate with the capten" as one channel, not a captain-specific
inbox).

This is a genuinely open transport decision, surfaced rather than silently
picked: a real-time channel (WebSockets/Socket.io) is the "impressive"
option and the one a chat feature instinctively suggests. **Recommendation:
plain HTTP polling for Fas 2.6b**, for reasons specific to this project's
current phase (CLAUDE.md: "build for the phase that's actually in front of
us... favor the boring, easy-to-change option"):

- No new infrastructure — no WebSocket gateway, no connection-state
  management, no change to `k8s/` (a stateful/sticky-session concern a
  plain REST poll never introduces), no new CVE surface.
- Team sizes are small ("a handful" of players per team, matching every
  other capacity assumption already made in this codebase, e.g. the
  weekly-goal history endpoint's "no pagination" call) — a few-second poll
  interval is an entirely acceptable chat experience at this scale, not a
  compromise users will notice.
- If real-time push becomes a real product need later (bigger teams, or
  cross-device "I want to see it the instant it's sent"), it's a genuine,
  separate follow-up ADR — not something to half-build now alongside
  everything else in this phase.

Response shape includes `reportedByMe` per message (Decision 1) and
excludes any message where `status = 'hidden'` or where
`sender_player_id` is on the viewer's own `TeamChatBlock` list (Decision 4)
— both filters applied in the same query, not layered as separate
post-processing steps, so there's one place that decides "is this message
visible to this viewer," not two that could drift apart.

`POST .../chat/messages` is gated on the same consent check
`TrainingLogsService` already uses
(`ParentalConsentStatus.APPROVED` only) — extending, not inventing, ADR-0002
addendum §2's reasoning: chat is genuine substantive processing/behavioral
data generation on a specific child (arguably more sensitive than a
training log, since it's freeform expression visible to peers, not a
duration/activity-type enum), so it gets at least the same gate a training
log already has. **Reading** chat is left ungated on consent, consistent
with every other team-scoped `GET` in this app (dashboard, roster,
weekly-goal) — a pending-consent player can already see the team's other
read-only surfaces; chat-read is not treated as more sensitive than those.

## Consequences

- Three new tables (`TeamChatMessage`, `TeamChatBlock`,
  `TeamChatMessageReport`), one new module (`team-chat/`), one new DI seam
  (`ChatModerationCheck`) with a Swedish keyword-list implementation, one
  new legitimate caller of `PlayerPrivateInfoService.getParentContact`, and
  best-effort use of the existing `Coach`/`TeamCoach` schema purely for its
  stored email address (no coach login/auth reactivated).
- No Redis structure added for chat — reads and writes both go straight to
  Postgres at this scale; if message volume or team count grows enough for
  this to matter, the same Postgres-then-Redis pattern ADR-0002 already
  establishes is the obvious next step, not built preemptively.
- **This ADR does not claim to fully close the "no adult in the loop"
  problem** — see Decision 3's explicit statement of residual risk. That
  gap, not the keyword filter or the block button, is the thing
  security-reviewer should spend the most time on before this merges.
- **Two decisions flagged above as deliberately considered and rejected**
  (auto-hide-on-report, captain-triggered team-wide hide) are recorded here
  so a future contributor doesn't quietly reintroduce either without
  revisiting the reasoning: both trade a real, if incomplete, safety gap for
  a peer-authority problem this project has consistently avoided elsewhere
  in Phase 2.
- Message content is stored and never encrypted-at-rest beyond whatever the
  Postgres deployment already provides generally — `docs/BACKLOG.md`
  already tracks "encryption of the data" as a future security enhancement
  independent of this feature; not a new gap introduced here, just inherited.
- See `docs/api/phase2.6b-contract.md` for the full endpoint contract
  (request/response shapes, error codes, rate-limit numbers) that
  backend-developer and frontend-developer build against directly.
