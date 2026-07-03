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
