# 0002 - Initial data model (Fas 1-3)

## Status

Accepted — 2026-07-03

## Context

We need a data model that covers Fas 1 MVP (Team/Player/Coach, individual
streak, team point pool) and doesn't need to be reshaped for what's already
visible in Fas 2 (Challenges, VM-Guld meter) and Fas 3 (media/consent-gated
uploads). It must also satisfy CLAUDE.md's non-negotiable constraints from
day one, because retrofitting privacy fields onto live child data later is
exactly the kind of rework we want to avoid:

- No location fields, anywhere, ever.
- A screen name (not real name) is the primary displayed identity.
- Parental consent must be trackable per-player *now*, even though media
  upload itself is Fas 3 — so the flag exists before there's any pressure to
  bolt it on quickly next to a half-built upload feature.
- Closed team bubbles — every player-visible query is scoped by team.

The individual streak series and the team point-pool series are genuinely
different systems (personal daily habit vs. shared season-long pot) with
different consumers (a leaderboard needs fast reads; a coach dashboard and
any future dispute ["why did our pool total drop?"] needs an auditable
history) — this ADR keeps them as separate entities rather than one
overloaded "points" table.

This is a design for two datastores, per the planned stack:

- **PostgreSQL** — durable source of truth. Anything we'd be upset to lose,
  anything that needs to survive a cache flush, anything with audit/legal
  weight (consent).
- **Redis** — fast/real-time access. Anything that's a cache or an
  accelerator over Postgres data, and should be safe to lose and rebuild.

## Decision

### Entities (PostgreSQL, source of truth)

All primary keys are UUIDs (avoids sequential-ID enumeration of a
child-data table, and plays nicely with offline-first mobile clients
later).

**Coach**
- `id`, `email` (login), `display_name`, `created_at`.
- A coach can be linked to one or more Teams (many-to-many via
  `TeamCoach`, since assistant coaches / multiple teams per coach are
  plausible even in Fas 1).

**Team**
- `id`, `name`, `invite_code` (how a player/parent joins a *specific*
  closed team — never an open directory), `created_at`.
- No public listing/searchability by design — a team is only reachable via
  its invite code, satisfying the closed-bubble constraint structurally,
  not just by a visibility flag that could be flipped later.

**Player**
- `id`, `team_id` (FK — a player belongs to exactly one team for Fas 1;
  mid-season transfers are a known future gap, see Consequences).
- `screen_name` — **required**, unique within a team, this is the identity
  shown everywhere (leaderboards, badges, later the feed). Chosen at
  onboarding, editable.
- `real_name` — **optional**, nullable. Only ever visible to the player's
  own coach(es) in an admin view, never surfaced in any player-facing UI,
  leaderboard, or (later) feed. Storing it is optional because some
  teams/parents will prefer not to.
- `birth_year` (not full date of birth) — coarse enough for age-appropriate
  challenge targeting ("11-åringar") without being an unnecessary precise
  DOB on a child.
- `parent_contact` — email or phone used solely to run the consent flow.
  Not displayed to other players.
- `parental_consent_status` — enum: `not_requested` / `pending` /
  `approved` / `revoked`. Gates any future media-upload capability (Fas 3
  checks this field; nothing else needs to change to switch that gate on).
- `avatar_id` or emoji key — a kid-friendly, non-photo identity option.
- **No location field of any kind.**
- `created_at`.

**ParentalConsentRecord** (audit trail, append-only)
- `id`, `player_id`, `status` (matches the enum above), `method` (e.g.
  `email_link`, `in_app_by_parent_account` — left open for
  ux-designer/backend-developer), `recorded_at`.
- Rationale for a separate append-only table rather than just the status
  field on Player: consent is the one area here with real legal weight
  (GDPR, children's data). A single mutable status field tells you the
  *current* state; this table proves *when and how* it changed. Cheap to
  add now, painful to reconstruct after the fact if a consent dispute ever
  comes up.

**TrainingLogEntry** (the "Jag har tränat" event — source of truth for
everything derived: streaks, team pool, challenge progress)
- `id`, `player_id`, `team_id` (denormalized for query convenience —
  team-scoped queries are extremely common), `logged_at` (timestamp — *when
  logged*, not where), `activity_type` (enum/free-form: fitness / drill /
  running / other), `duration_minutes`, `challenge_id` (nullable FK, set if
  this log counts toward a Fas 2 challenge), `created_at`.
- This is an append-only event log. Both the Player's streak counters and
  the Team's season pot total are derived from it and kept in sync
  transactionally on insert (see below) — the log itself is what you'd
  replay to rebuild either if something ever got out of sync.

**Player streak fields** (denormalized onto Player, updated in the same
transaction as each TrainingLogEntry insert)
- `current_streak_count`, `longest_streak_count`, `last_trained_date`.
- These live in Postgres, not only in Redis, specifically so the durable
  record of "how long was this kid's longest streak" survives a Redis
  flush/restart without needing a backfill job. Redis holds a fast-access
  copy for the hot path (see below).

**Season**
- `id`, `team_id`, `label` (e.g. "Vår 2026"), `start_date`, `end_date`.
- The team pool resets/tracks per season, per the README ("under en månad
  eller säsong") — modeling Season explicitly now avoids a schema change
  the first time a coach asks to start a new pool.

**TeamSeasonPot**
- `id`, `team_id`, `season_id`, `points_total`, `goal_threshold` (the
  VM-Guld target), `status` (`active` / `achieved` / `closed`).
- `points_total` is authoritative here in Postgres, updated transactionally
  alongside each relevant TrainingLogEntry insert. Redis holds a live cache
  of this value for fast dashboard/meter reads (see below).

**Badge**
- `id`, `key` (e.g. `best_effort`, `most_creative_drill`), `display_name`,
  `description`, `icon`.
- Static-ish catalog of available badges (seeded data, not really
  user-generated in Fas 1-2).

**BadgeAward**
- `id`, `player_id`, `badge_id`, `awarded_at`, `context` (free text/JSON —
  what triggered it, useful for the "why did I get this" UI and for
  coach/debugging visibility), `awarded_by` (`system` or a coach's id, for
  the manual-award case).
- Many-to-many join table shaped to allow the same badge to be awarded to
  the same player more than once over time (e.g. "Best effort" repeating
  weekly), which a plain boolean-per-player would prevent.

**Challenge** (Fas 2, modeled now since it's next up and touches
TrainingLogEntry via `challenge_id`)
- `id`, `team_id`, `created_by_coach_id`, `title`, `description`,
  `target_metric` (e.g. total minutes, count of a named drill),
  `target_value`, `start_date`, `end_date`, `status`.
- Progress is derived by summing `TrainingLogEntry` rows tagged with this
  `challenge_id` — no separate progress table needed at this size; Redis
  can cache the running total per active challenge the same way it caches
  the season pot, if/when that becomes a live-updating UI element.

### What lives in Redis (cache/accelerator, not source of truth)

Everything here should be treated as *derivable* from Postgres — safe to
lose, rebuildable, never the only copy of anything:

- **Per-player live streak state** for the hot "did they already log today"
  check the API makes on every "Jag har tränat" tap (fast idempotency
  check, avoids a Postgres round-trip on the single most frequent write in
  the app).
- **Team pool live gauge** — cached `points_total` per `TeamSeasonPot`,
  updated on write, read on every home-screen/dashboard load so the VM-Guld
  meter feels instant.
- **Leaderboards** — Redis sorted sets, e.g. per-team individual streak
  leaderboard, keyed by team so a query is always naturally team-scoped
  (reinforcing the closed-bubble constraint, not fighting it).

Write path: an insert into `TrainingLogEntry` happens inside a Postgres
transaction that also updates the denormalized `Player` streak fields and
`TeamSeasonPot.points_total`; the same request then updates the
corresponding Redis keys/sorted sets. If Redis is ever cleared, it can be
repopulated from Postgres with a rebuild job — this should be called out as
a small utility for backend-developer to write, not left implicit.

## Consequences

- Every entity that could carry personal data (`Player`, `ParentalConsentRecord`)
  has been designed with the constraints as structural defaults, not flags
  to remember to set correctly later: screen name is the identity field,
  real name is optional and coach-only, there is no location column
  anywhere in this model, and consent is trackable before Fas 3 needs it.
- Two extra tables exist ahead of when they're strictly load-bearing
  (`ParentalConsentRecord` before Fas 3 media, `Challenge`/`Season` slightly
  ahead of Fas 2 wiring). This is deliberate — they're cheap to add now and
  expensive to retrofit onto live child data later — but security-reviewer
  should still confirm the consent flow's actual UX (who triggers it, how a
  parent approves) before Fas 3, this ADR only fixes the data shape.
  Team-Coach and Challenge as separate tables are a small amount of
  now-unused schema; that's an acceptable, explicitly-flagged trade here,
  not scope creep to repeat by default in future ADRs.
- `Player.team_id` as a single FK means no mid-season team transfer history.
  Fine for Fas 1-2; if roster changes across seasons become common, this
  will need a `TeamMembership` join table with date ranges — flagged here
  so it's a deliberate follow-up ADR, not a surprise migration.
- Keeping `TrainingLogEntry` as an authoritative append-only log (rather
  than only incrementing counters) means streak/pool logic bugs are
  debuggable and recomputation is always possible — this is worth the
  extra table for a project that won't have a dedicated ops/support team
  to hand-fix corrupted counters.
- backend-developer should treat the Postgres-transaction-then-Redis-update
  write path as the standard pattern for both streak logging and pool
  updates — code-critic's Phase 1 review should specifically check this
  ordering (e.g. midnight rollover, concurrent team-pool writes, as already
  flagged in ACTION_PLAN.md).

## Addendum — 2026-07-03

Revisited before backend-developer turns this ADR into real Phase 1
migrations, to close three gaps security-reviewer flagged during the Phase
0 review (tracked in ACTION_PLAN.md, referenced in CLAUDE.md's open
decisions). This addendum amends the Decision above; it doesn't replace it.

### 1. `real_name` (and `parent_contact`) move to a `PlayerPrivateInfo` table

**Problem:** `real_name` is currently just a nullable column on `Player`
with a *convention* ("coach-only, never surfaced player-facing") enforced
by nothing structural. Any query against `Player` — including one written
for a leaderboard, a feed, or a careless `SELECT *` in a new feature six
months from now — gets it back by default. That's a materially weaker
guarantee than `ParentalConsentRecord`, which is safe from this class of
bug simply because it lives in a different table that ordinary
player-facing queries never join.

**Decision:** Move `real_name` off `Player` into a new one-to-one table,
`PlayerPrivateInfo`:

- `player_id` (PK, FK → `player.id`, `ON DELETE CASCADE`)
- `real_name` (nullable — storing it stays optional, as today)
- `parent_contact` (required — needed to run the consent flow)
- `created_at`, `updated_at`

`parent_contact` is folded into the same table for the identical reason,
even though the task that raised this gap named only `real_name`: it's the
other field on `Player` that's direct personal data (a parent's email/phone)
with a narrow, single-purpose set of legitimate consumers (the consent
flow), and leaving it behind on `Player` while moving `real_name` would
just relocate the same leak vector one column over. `birth_year` stays on
`Player`: it's coarse (year only), low-sensitivity, and has a genuine
broader operational consumer (age-banded challenge targeting), unlike
`real_name`/`parent_contact` — this isn't "move everything private," it's
moving the fields whose only legitimate readers are a narrow, specific
purpose.

Access path, enforced by module boundaries rather than convention: a
`PlayerPrivateInfoModule` owns this table and is the *only* thing that
imports it. It exposes two narrow read paths — the consent-flow service
(reads/writes `parent_contact`) and a coach-only admin endpoint gated by
`TeamCoach` membership (reads `real_name`) — and nothing else. `PlayerModule`
(and therefore every leaderboard/feed/badge query built against `Player`)
does not depend on `PlayerPrivateInfoModule` at all, so a future query
against `Player` structurally cannot return this data, the same way it
already can't accidentally return consent history today.

**Consequences:** one extra join for the (rare, admin-only) coach "view
real name" action; everything else is unchanged. Migration: drop
`real_name`, `parent_contact` from `Player`; add `PlayerPrivateInfo`.

### 2. `parental_consent_status` gates gameplay, not just media — but not the account row itself

**Problem:** as shipped, the field only gates Fas 3 media upload. Given
users as young as ~9 and that this is a Swedish youth-sports app, is it
enough to gate media, or should it gate the account/player record from
existing at all until a parent approves?

**Decision: gate the first `TrainingLogEntry`, not the `Player` row.**
Concretely, two things change:

- **Creating the onboarding "shell"** — joining a team via `invite_code`,
  choosing `screen_name`/`avatar_id`, recording `birth_year` and
  `parent_contact` — is allowed immediately, with no wait on approval. This
  is exactly the data GDPR expects you to be able to hold *in order to ask
  for consent in the first place* (you can't request parental consent
  without first knowing which parent to contact) — it's not the
  substantive processing the constraint is protecting against. Creating
  the row also auto-sets `parental_consent_status = pending` and writes
  the first `ParentalConsentRecord`.
- **The gate moves from "media only" to "any `TrainingLogEntry` insert."**
  A `TrainingLogEntry` is where the app starts accumulating an actual
  behavioral history on a specific child (a training log, a streak) —
  that's the substantive processing GDPR cares about, and it's a stricter
  gate than the current media-only one, not a weaker one. Until
  `parental_consent_status = approved`, "Jag har tränat" exists in the UI
  but the API rejects the write (see `phase1-contract.md`'s
  `consent_required` response) and the home screen shows a waiting state
  instead of a streak.

**Why not gate the account row itself:** blocking creation entirely on
parent approval reintroduces exactly the onboarding-friction problem
CLAUDE.md warns about — a coach trying to register 15 kids in one practice
session, each now waiting on an email round-trip before they can even pick
a screen name — for no compliance benefit, since the fields collected at
that step are the minimum needed to run the consent request itself.
Gating the first real write instead protects the same thing more precisely
without adding friction to a step that was never the risky one.

**Age-band nuance, flagged not resolved:** Sweden set the GDPR Art. 8
self-consent age for "information society services" at 13. For players
who are 13+ (derivable from `birth_year`), it's plausible the consent
request should go to the player rather than strictly a parent — the schema
already anticipates this via `ParentalConsentRecord.method`'s
`in_app_by_parent_account` vs `email_link` split. The gate mechanism
(block writes until `approved`) is identical either way; only *who* is
allowed to click approve differs. That's a legal/policy call for
security-reviewer to confirm with real guidance before Fas 1 ships, not a
schema change — no new column is needed for this decision, only a change
in enforcement point (service-layer check on `TrainingLogEntry` creation)
and in what the home screen surfaces.

### 3. `BadgeAward.context` becomes a constrained, discriminated shape

**Problem:** freeform text/JSON on a field explicitly there to explain
"why did I get this badge" is the one place in this model expressive
enough to become a backdoor for exactly the location/PII data the rest of
the schema deliberately excludes — nothing stops a future contributor from
putting `{ "location": "..." }` in it under deadline pressure.

**Decision:** `context` stays a Postgres `jsonb` column (a handful of
nullable columns for a small variant type isn't worth it), but it's no
longer treated as an open bag — it's validated at the API boundary as a
discriminated union keyed by a required, fixed `trigger_reason`:

```ts
type BadgeAwardContext =
  | { triggerReason: 'streak_milestone'; streakCount: number }
  | { triggerReason: 'challenge_completed'; challengeId: string }      // FK, validated
  | { triggerReason: 'team_pool_milestone'; teamSeasonPotId: string; percentComplete: number }
  | { triggerReason: 'coach_manual_award'; note?: string }             // max 140 chars
  | { triggerReason: 'effort_nomination'; note?: string };             // max 140 chars
```

Rules:

- `triggerReason` is required and is one of this fixed enum; nothing else
  is accepted.
- Every other key comes from the fixed map above for that `triggerReason` —
  a NestJS DTO (class-validator discriminated union) rejects any key not
  in the map, so this is an enforced boundary, not a naming convention.
- `challengeId` / `teamSeasonPotId` are UUID foreign-key references,
  validated against real rows — not free text, so they can't smuggle
  arbitrary data.
- The only freeform value anywhere in `context` is the `note` string on the
  two human-authored reasons, capped at 140 characters and writable only
  by a coach through an authenticated coach-only endpoint — never
  client-suppliable by the player being awarded the badge.
- No key resembling location/address/coordinates is in the allow-list, and
  none gets added to it without a fresh ADR — this field is the one place
  in the model expressive enough to need that discipline explicitly stated.
- `BadgeAward` rows are only ever written by trusted backend code (the
  streak/challenge/pool computation jobs, or the coach-only manual-award
  endpoint) — never by persisting a client-supplied JSON blob directly.
  That write-path restriction is what actually prevents "freeform JSON
  backdoor," the enum alone wouldn't.

**Consequences:** a future badge trigger needs its variant added to this
map — a small, reviewable diff — instead of being able to put anything it
wants into `context`. Same "boring but constrained" trade the rest of this
ADR already makes.

### Net effect on Consequences (above)

- One new table (`PlayerPrivateInfo`); `Player` loses `real_name` and
  `parent_contact`. No new column for the consent gate — only a change in
  what enforces it and where (service layer on `TrainingLogEntry` create,
  not the media-upload path). `BadgeAward.context` keeps its column type
  but gains DTO-level validation.
- These are schema/enforcement decisions only; security-reviewer still
  needs to sign off on the actual consent-flow UX (age-band handling,
  wording, who receives the link) before Fas 1 is considered done, per
  ACTION_PLAN.md.
