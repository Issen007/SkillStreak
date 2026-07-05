# 0005 - Kapten (team captain) and the weekly team goal

## Status

Accepted — 2026-07-05

## Context

The project owner reviewed the Phase 2 coach-dashboard plan
(`docs/adr/0004-coach-auth-and-session-reissue.md`,
`docs/api/phase2-contract.md`, `docs/design/phase2-flows.md`) and pivoted,
in their own words:

> "instead of having a Coach view, the team could set one person in the
> team to be the motivator or captain of the team. This person can set the
> team's goals for the week and this is the 'Coach view'... And if the
> team successfully reach the goal they get extra team points, +5p per team
> exercises."

Follow-up clarification turned this into four decided constraints, not open
questions:

1. The player-captain **fully replaces** the coach concept for Phase 2 — no
   separate adult "Coach" login/dashboard. Whoever is captain uses their
   existing player account and existing player JWT.
2. Captain is **assigned manually** — a seed/admin action, same posture
   Phase 1 took with team/invite-code creation — not an in-app
   election/voting flow, not automatic rotation.
3. The point bonus is a **one-time lump sum, corrected 2026-07-05 after a
   conflict surfaced**: the project owner's own `docs/ACTION_PLAN.md` entry
   specified "+5p for each challenge and +1p for each minute of the
   challenge," which is a different formula than the "retroactive +5 per
   log" this ADR originally implemented below. Asked directly to resolve
   the conflict, the project owner confirmed: **flat +5, plus 1 point per
   team-wide minute logged toward the goal, awarded once** when the goal is
   first met — not a per-log, ongoing bonus. Decision 3 below reflects the
   corrected mechanic; see its note on what changed and why.
4. The role is called **"Kapten"** (Swedish for captain) in-app.

This ADR is the data-model and mechanism decision that follows from those
constraints. It supersedes `docs/adr/0004`'s Parts 1-2 (see that ADR's
2026-07-05 addendum) and overrides the "progress is individual, not
team-pooled" judgment call in `docs/design/phase2-flows.md` (that doc's Part
3 and its judgment call #2) — a follow-up ux-designer pass will redesign the
player-facing screens against this ADR's data model, not the other way
round.

Three concrete design questions follow from the pivot, each addressed below:

- How is "captain" represented on `Player`, and how do we guarantee a team
  has at most one active captain?
- Does the existing `Challenge` entity get reused for "this week's team
  goal," and if so, what changes — especially since the pitch explicitly
  reframes progress as team-wide, not per-player?
- Exactly when and how does the goal-completion point bonus fire, and how
  is it made idempotent without any scheduled-job infrastructure?

## Decision — 1: Captain is a `Player` attribute, not a new role/account system

**Add `Player.is_captain` (boolean, not null, default `false`). Enforce
"at most one active captain per team" with a partial unique index, not
application logic or a join table.**

```sql
CREATE UNIQUE INDEX idx_player_one_captain_per_team
  ON player (team_id)
  WHERE is_captain = true;
```

### Why a boolean column, not a join table

`Player.team_id` is already a single FK — every player belongs to exactly
one team (ADR-0002; mid-season transfers are an explicitly flagged future
gap, unrelated to this decision). Because of that, "is this player their
team's captain" needs no extra relation to express — there's no
many-to-many shape here the way `TeamCoach` has for coaches-across-teams.
A `TeamCaptain` join table would model a relationship that structurally
cannot be many-to-many in this schema (a player has one team; captaincy is
scoped to that one team by construction), so it would be pure ceremony —
exactly the kind of "impressive but unnecessary" option CLAUDE.md asks
architect to avoid. A boolean column is the boring, correct fit.

### Why a DB-level partial unique index, not application logic alone

The task explicitly asks whether "exactly one active captain" should be
enforced by a unique partial index, application logic, or a join table.
Application-only enforcement (read-current-captain, unset it, set the new
one, all in a service method) is *usually* fine for a low-traffic,
admin-triggered action — but it's exactly the kind of invariant that's
cheap to guarantee at the database level and expensive to debug if it's
ever silently violated (e.g. a second admin/seed script run concurrently,
a future in-app "reassign captain" feature written without noticing the
existing one, a bad manual `UPDATE` during support). A partial unique index
costs nothing (one migration statement, no extra table, no extra query on
the hot path — reads never touch it) and makes "two active captains for one
team" a constraint violation instead of a bug report. This is the same
reasoning ADR-0002/ACTION_PLAN already flagged as a gap for
`TeamSeasonPot` ("no DB-level uniqueness guard against two simultaneously
active pots") — this decision closes the equivalent gap for captaincy
proactively instead of repeating it.

Reassigning captaincy (should it ever be needed) is then just: within one
transaction, `UPDATE player SET is_captain = false WHERE team_id = :teamId
AND is_captain = true`, then `UPDATE player SET is_captain = true WHERE id
= :newCaptainId` — the second statement fails loudly against the partial
index if the first one didn't actually clear the old captain, rather than
silently producing two.

### Assignment mechanism

**Manual, out of band — a seed/admin script, not an in-app action**, per
constraint #2 above. This is the same posture Phase 1 already took for team
creation and invite codes (`docs/adr/0002-data-model.md`,
`docs/api/phase1-contract.md`): a backend-developer script (e.g. extending
`backend/src/scripts/seed.ts`, or a small standalone admin script) sets
`is_captain = true` for a given `(teamId, playerId)` pair, clearing any
prior captain for that team first, inside one transaction, relying on the
partial index as the backstop. No in-app election/voting UI, no automatic
rotation (e.g. "captain of the week") — those are plausible future features
explicitly out of scope now, not implied by anything here.

### Authorization: no new guard class

Every weekly-goal/roster/captain-only endpoint uses the **existing**
`JwtAuthGuard` (unchanged, still populating `request.playerId`, still
carrying Part 3's `token_version` check from ADR-0004) plus a
**service-layer check**: load the requesting player's own row (already a
cheap indexed PK lookup, same pattern `TrainingLogsService.logTraining`
already uses for the consent check), verify `player.teamId === :teamId`
and `player.isCaptain === true`, else `403 not_team_captain`. This is
deliberately not a new `CaptainGuard` class: a captain check is a single
boolean flag on the same `Player` row every other check already loads, not
a second identity/authorization system the way coach-vs-player was — a
small `assertIsCaptainOfTeam(playerId, teamId)` method on
`PlayersService` (or the weekly-goal service, see below) is enough, called
at the top of the relevant controller methods. See
`docs/api/phase2-contract.md`'s Conventions section for exactly which
endpoints call it.

## Decision — 2: `Challenge` is reused as "this week's team goal"; progress becomes team-wide, and per-log tagging is dropped for this feature

### Reuse the entity; change who creates it and what "progress" means

`Challenge` (`backend/src/challenges/entities/challenge.entity.ts`) already
has `teamId`, `title`, `description`, `targetMetric`, `targetValue`,
`startDate`, `endDate`, `status` — exactly the shape of "a team's goal for a
date range, described in the captain's own words, with a mechanically
trackable target." Reusing it (rather than a new, near-identical entity) is
the boring option and avoids a second copy of the same
draft→active→completed/cancelled state machine `docs/api/phase2-contract.md`
already specified. **The entity/table name stays `Challenge`/`challenge`** —
renaming it would be pure churn (nothing has been built against it yet, but
ADR-0002 and the Phase 1 migration already establish the name, and a
distinct future "individual challenge" feature, if ever built, might
legitimately want the same generic shape under the same name). The Phase 2
*product* language is "veckans mål" ("the weekly goal") / "Kapten" — that
naming lives in the API route (`/weekly-goal`) and UI copy, not the schema,
the same way "SkillStreak" as a working title doesn't leak into code
(CLAUDE.md).

**Schema changes to `Challenge`:**

```
Challenge
  id                     (unchanged)
  team_id                (unchanged)
  created_by_coach_id     → RENAMED created_by_player_id, uuid, FK → player.id, ON DELETE RESTRICT
  title                  (unchanged)
  description            (unchanged)
  target_metric          (unchanged — reuses the 5-value preset from phase2-flows.md's CB2:
                           fitness-minuter / drill-minuter / running-minuter / other-minuter / total-minuter)
  target_value           (unchanged)
  start_date             (unchanged)
  end_date               (unchanged)
  status                 (unchanged — draft / active / completed / cancelled)
  goal_bonus_awarded_at  timestamptz, nullable                          -- NEW
```

`created_by_coach_id` never held any data (no Challenge CRUD was ever
built — see the Phase 1 migration's comment: "no service/controller for
this entity in Phase 1, just the table + FK"), so this is a clean rename
in the same migration that first makes the column real, not a live-data
migration concern. Keep the same `ON DELETE RESTRICT` reasoning the
original column had (don't silently orphan a goal by deleting the player
who created it — RESTRICT means a captain's account can't be deleted while
they still have authored goals on record; acceptable since player deletion
isn't a feature that exists yet either).

**New constraint — at most one active goal per team at a time:**

```sql
CREATE UNIQUE INDEX idx_challenge_one_active_goal_per_team
  ON challenge (team_id)
  WHERE status = 'active';
```

The pitch's framing ("the team's goal for the week") only makes sense as a
single current target — "did the team reach *its* goal" is ambiguous if two
goals could be active simultaneously, and the retroactive bonus mechanic
below needs an unambiguous "the" active goal to check progress against.
Same DB-level-guarantee reasoning as the captain constraint above, and it
closes the same class of gap ACTION_PLAN already flagged for
`TeamSeasonPot`. Multiple **drafts** can coexist with one active goal (a
captain drafting next week's goal while this week's is still running is
fine); only *activating* a second one while one is already active is
rejected (`409 active_goal_already_exists` — see the contract doc).

### Progress is team-wide, computed automatically — no `challengeId` tagging

This is the one place `docs/design/phase2-flows.md`'s existing judgment
call is overridden, not extended: that doc chose **individual** per-player
progress, reasoning that "the team...reach the goal" would read like a
personal target and that VM-Guld already owns the "one pooled number" hook.
The project owner's own framing in this pivot is explicitly team-wide
("the team could... set the team's goals for the week... if the team
successfully reach the goal") — a real requirements change, not a
reinterpretation, so the prior reasoning no longer applies. (VM-Guld and the
weekly goal now both being team-wide numbers is fine — VM-Guld is the
season-long pot; the weekly goal is a much shorter-lived, captain-authored
sub-target that happens to pay into the same pot when it's cleared. They're
not in competition for the same "one shared number" psychological hook,
they're two different timescales of the same pot.)

**Progress formula:**

```
teamProgress = SUM(training_log_entry.duration_minutes)
  WHERE training_log_entry.team_id = challenge.team_id
    AND training_log_entry.logged_at::date BETWEEN challenge.start_date AND challenge.end_date
    AND (challenge.target_metric = 'total-minuter'
         OR training_log_entry.activity_type maps to challenge.target_metric)
```

Computed live from `TrainingLogEntry` — every team member's every log in
range counts automatically, from every player on the team, with **no
`challengeId` tag required on the log at all.** This is a deliberate,
concrete answer to the task's open question:

- **`POST /training-logs`'s `challengeId` field and its Phase-2-planned
  validation (three checks: exists/belongs to team, is active,
  metric-compatible) are dropped, not simplified, for this feature.**
  There is nothing to tag: a team-wide goal that auto-aggregates every
  matching log needs no per-log opt-in step, and building the tagging UI
  (`phase2-flows.md`'s H2 addendum, "Räkna till en utmaning?") for a
  feature that doesn't consume the tag would be exactly the kind of
  half-built, immediately-obsolete work the task calls out to avoid.
- `TrainingLogEntry.challenge_id` **stays in the schema, untouched, exactly
  as dormant as it already was in Phase 1** ("modeled now... no
  service/controller... not consumed by any logic in Phase 1" — see that
  entity's existing comment). `POST /training-logs` needs **no request/
  response shape change** for this feature (see below for the one addition
  it does need, which is unrelated to `challengeId`).
- If a genuinely **individual**, opt-in challenge feature is ever built
  later (a real "50 zorro-finter, just for you" per-player target, distinct
  from the team's weekly goal), it can revive `challengeId` tagging then —
  that is a real, separate feature with its own design work, not something
  to half-build alongside this one. Flagging this explicitly, per the
  task's instruction not to silently pick one and abandon the other without
  saying so.

### What a captain can set, and what freezes once active

Unchanged from the original contract's judgment calls (still the right
calls, independent of the coach→captain pivot): `targetMetric`,
`targetValue`, `startDate`, `endDate` are frozen the moment `status` leaves
`draft` (`409 challenge_target_frozen` on a `PATCH` attempting to change
them otherwise) — this matters *more*, not less, now that a real point
payout is on the line: a captain shrinking `targetValue` mid-week once the
team is close, to trigger the bonus early, is now a concrete incentive to
guard against, not just a fairness nicety. `title`/`description` remain
editable at any non-terminal status. Status transitions remain
`draft → active`, `active → completed`, `active → cancelled` only.

## Decision — 3: the goal-completion bonus mechanic

**Checked opportunistically, inside the same Postgres transaction as every
`POST /training-logs` write — no scheduled job, no Kubernetes CronJob.**
This matches the project's actual infrastructure (per CLAUDE.md, Kubernetes
is a Fas 4 goal; even the plain `k8s/` manifests pulled forward for the
beta don't include job scheduling) and the pattern this codebase already
uses for exactly this shape of problem (`TrainingLogsService.logTraining`
already does a pre-transaction check, a row-locked re-read, and an
in-transaction write for the consent/streak/pool logic — this is one more
step in that same transaction, not a new architectural pattern).

**Corrected 2026-07-05:** this section originally specified a "+5 per log,
retroactive-then-ongoing" mechanic. That conflicted with the project
owner's own `docs/ACTION_PLAN.md` entry ("+5p for each challenge and +1p
for each minute of the challenge"), and, asked directly, the project owner
confirmed the ACTION_PLAN wording is correct: **a single lump-sum bonus —
flat +5, plus 1 point per team-wide minute logged toward the goal — paid
once**, not a per-log or ongoing bonus. The transaction/idempotency
structure below is unchanged from the original design (it was already
correct); only the awarded-amount formula and the "does it keep paying
after the crossing" question changed.

### Exact algorithm

Runs inside `TrainingLogsService.logTraining`'s existing
`dataSource.transaction(...)` block, **after** the new `TrainingLogEntry`
row is inserted and the base team-pool points
(`pointsForTrainingLog(durationMinutes)`) are added, using the same
`manager`:

1. **Load the team's active goal, row-locked:**
   `SELECT ... FROM challenge WHERE team_id = :teamId AND status = 'active'
   FOR UPDATE` — at most one row can match, thanks to the partial unique
   index in Decision 2, so this is a cheap indexed lookup with a lock that
   also naturally serializes two concurrent training-log writes for the
   same team that might otherwise race on the crossing check below.
2. **Short-circuit if not relevant:** no active goal, this log's
   `loggedAt` date falls outside `[startDate, endDate]`, or
   `challenge.goalBonusAwardedAt IS NOT NULL` (already paid — see below) →
   do nothing further. This covers the common case on every request (no
   goal running, a log outside its window) and the "goal already met"
   case, which needs no further work of any kind now that the bonus is a
   one-time payment, not an ongoing one.
3. **Compute team-wide progress** (Decision 2's formula — `SUM(duration_minutes)`
   across the team, in range, metric-filtered) **including the log just
   inserted** (it's in the same transaction, so it's visible to this
   query). Call this `progress`.
4. **If `progress < targetValue`:** nothing else to do. The log's base
   points were already added in the ordinary flow; the goal simply isn't
   met yet.
5. **If `progress >= targetValue`** (this is necessarily the first and only
   crossing, since step 2 already filtered out goals with
   `goalBonusAwardedAt` set):
   - `awardedPoints = 5 + progress` — flat 5, plus 1 point per team-wide
     minute (`progress` **is** that minute count; it's the same number
     just computed for the target check, not a separate query).
   - `UPDATE team_season_pot SET points_total = points_total +
     :awardedPoints WHERE id = :potId` — one atomic increment.
   - `UPDATE challenge SET goal_bonus_awarded_at = now() WHERE id =
     :challengeId` — **the idempotency flag.** Set in the same
     transaction, under the row lock acquired in step 1, so a second
     write racing at the same instant either blocks until this
     transaction commits (then sees `goalBonusAwardedAt` already set and
     takes step 2's short-circuit) or is itself the one that wins the
     race — Postgres's row lock, not application logic, is what prevents
     a double award.

This is simpler than the mechanic it replaces: no `qualifyingLogCount`
query, no "continues paying per subsequent log" branch — the bonus fires
exactly once per goal, full stop, which is both what the confirmed formula
requires and less code to get right.

### Interaction with status transitions

- **`active → cancelled` or `active → completed`:** whether the bonus was
  already paid or never triggered, nothing further happens — the one-time
  payment either already landed (and is never clawed back, same precedent
  as a `BadgeAward`) or the team simply didn't reach the goal in time (the
  expected, unremarkable case, no special handling needed). Once
  non-`active`, step 1's query (`WHERE status = 'active'`) won't find the
  goal at all, so this is naturally enforced, not a separate check.
- Who/what calls `active → completed` is unchanged from the original
  contract's judgment call: a captain action via `PATCH`, or a future
  automatic end-of-day sweep once `endDate` passes — not mandated here.

### Surfacing the bonus to the client without a second round-trip

`POST /training-logs`'s response gains one new, optional field —
`goalBonus` — computed from the same transaction, no shape change to the
request:

```ts
{
  trainingLogId: string;
  loggedAt: string;
  streak: { ...unchanged };
  teamPool: { pointsTotal, goalThreshold, percentComplete }; // unchanged shape; pointsTotal already reflects any bonus
  goalBonus: { awardedPoints: number } | null; // NEW
}
```

- `null` — no active goal in range, goal not yet met, or the goal was
  already met by an earlier log (this response has nothing new to report).
- `{ awardedPoints: 5 + progress }` — this log caused the one-time
  crossing; `awardedPoints` is the total lump-sum bonus just applied to
  the team pool (the number worth celebrating). Because the bonus only
  ever fires once per goal, a non-null `goalBonus` unambiguously means
  "this log is the one that just did it" — no separate flag needed to
  distinguish that from an "already met" case, since the latter is now
  folded into the `null` case.

This gives frontend the exact hook needed for a celebratory moment (e.g.
"Laget nådde sitt mål! +65 bonuspoäng!") without a second API call, matching
Phase 1's established "no extra round-trip" principle. Designing the exact
celebratory copy/animation is a ux-designer follow-up, not fixed here.

## Consequences

- New migration: `challenge.created_by_coach_id` renamed to
  `created_by_player_id` (FK retargeted to `player.id`); new nullable
  `challenge.goal_bonus_awarded_at`; new partial unique index on
  `challenge(team_id) WHERE status = 'active'`. New `player.is_captain`
  boolean column (default `false`); new partial unique index on
  `player(team_id) WHERE is_captain = true`. All additive/renaming, no
  data-loss risk (neither column has ever held data — no Challenge CRUD or
  captain concept existed before Phase 2).
- `Coach`/`TeamCoach` tables remain in the schema, unused, per ADR-0004's
  addendum — not this ADR's concern beyond noting the `Challenge` FK no
  longer points at `Coach`.
- `TrainingLogsService.logTraining`'s transaction grows one more step (the
  bonus check above) — still one Postgres transaction, still
  Postgres-then-Redis per ADR-0002's write-path pattern; no Redis change
  needed for the bonus itself (it only ever touches
  `TeamSeasonPot.points_total`, whose Redis gauge already gets refreshed
  after commit by the existing `redisService.setTeamPoolGauge` call).
- `docs/design/phase2-flows.md`'s Part 3 (player-facing challenge card) and
  its judgment call #2 (individual progress) are superseded by this ADR —
  flagged for the follow-up ux-designer pass to redesign around a
  team-wide progress meter (structurally closer to the VM-Guld gold meter
  than the individual flame meter, since progress is now a shared number),
  not something this ADR designs in visual/copy terms.
- `docs/api/phase2-contract.md` is rewritten alongside this ADR to reflect:
  no coach endpoints; `POST/PATCH /teams/:teamId/weekly-goal` gated on
  captain status; `GET` endpoints open to any team player;
  `POST /training-logs` unchanged in request shape, with the new
  `goalBonus` response field.
- security-reviewer follow-up, flagged explicitly rather than assumed
  fine: the consent-reminder-resend and session-reissue actions (formerly
  coach-triggered) are now triggered by a **child captain** acting on a
  **teammate's** account/consent state, not an adult acting on a child's.
  Nothing about the underlying mechanisms changes (same rate limits, same
  token/code shapes), but the trust model shifts from "an adult coach
  helping a kid" to "one kid helping another kid, with a manually-assigned
  flag" — worth an explicit sign-off before this ships, not silently
  inherited from the old design's review.
