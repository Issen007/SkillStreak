# 0015 - Weekly team goal: per-player completion, not a pooled total

## Status

Proposed — 2026-07-31.

## Context

`docs/BACKLOG.md`'s "Weekly team goal: currently pooled, needs a per-player
completion requirement" entry, raised by the project owner 2026-07-30,
verbatim: today's weekly goal (e.g. "run 2 times this week") is satisfied
by the **team's pooled total** — one highly active player can complete it
alone while teammates never train. The intent is the opposite: **every
player on the team completes the goal individually**.

This is the same class of change as ADR-0005 Decision 3's 2026-07-05
bonus-formula correction (`docs/ACTION_PLAN.md`) — a correction to an
already-shipped, already-reviewed formula, not a new feature — and gets the
same rigor: read in full against `weekly-goal.service.ts`,
`weekly-goal-target-metric.enum.ts`, `weekly-goal-transition.util.ts`, the
`dto/` files, `PlayersService.listByTeam`/`assertTeamMembership`, and
`docs/adr/0013-account-erasure.md` Decision 6 ("goals outlive their
creator") before drafting this.

Four concrete questions were raised in the backlog entry; each gets a real
decision below, not an assumption:

1. Today's `WeeklyGoalTargetMetric` is minutes-only. "Run 2 times" is a
   session-*count* goal, a shape that doesn't exist yet.
2. What happens to a player who's mid-consent, joined mid-week, or was
   simply inactive — a per-player check can't let one player's excess
   quietly cover for another's absence the way the pooled model did.
3. Does a departed/erased player (ADR-0013 Decision 6) count as a
   permanent miss, or get excluded retroactively?
4. The dashboard's single progress bar needs to become a per-teammate
   completion view — what data shape drives that?

## Decision 1 — session-count goals are five new `WeeklyGoalTargetMetric` values, not a new column

**Extend the existing 5-value preset to 10 values, adding a `-pass`
("träningspass"/session) counterpart to each existing `-minuter` value,
rather than adding a separate `targetUnit` column alongside the unchanged
5-value metric.**

```ts
export enum WeeklyGoalTargetMetric {
  FITNESS_MINUTER = 'fitness-minuter',
  DRILL_MINUTER = 'drill-minuter',
  RUNNING_MINUTER = 'running-minuter',
  OTHER_MINUTER = 'other-minuter',
  TOTAL_MINUTER = 'total-minuter',
  FITNESS_PASS = 'fitness-pass',   // NEW
  DRILL_PASS = 'drill-pass',       // NEW
  RUNNING_PASS = 'running-pass',   // NEW
  OTHER_PASS = 'other-pass',       // NEW
  TOTAL_PASS = 'total-pass',       // NEW
}

export const TARGET_UNIT_BY_TARGET_METRIC: Record<
  WeeklyGoalTargetMetric,
  'minutes' | 'sessions'
> = { /* the five -minuter values -> 'minutes', the five -pass values -> 'sessions' */ };
```

`ACTIVITY_TYPE_BY_TARGET_METRIC` gains four entries (`*_PASS` maps to the
same `ActivityType` as its `*_MINUTER` counterpart; `TOTAL_PASS`, like
`TOTAL_MINUTER`, has no entry — no activity filter). "Session count" means
**number of qualifying `TrainingLogEntry` rows in the date range**, not
distinct days — logging two separate running sessions on the same day
genuinely counts as two, matching "pass" (session), not "day".

### Why this, not a separate `targetUnit` column

A `targetMetric` + `targetUnit` pair needs its own validation to reject
nonsensical combinations (`running-minuter` + `sessions`) and needs a data
migration to strip the now-redundant `-minuter` suffix from the 5 existing
values if the metric enum is to stop encoding the unit itself. Fusing unit
into the metric value avoids both: no new column, no migration touching
existing `challenge` rows (their 5 existing values are untouched, still
mean exactly what they meant before), and every one of the 10 accepted
values is self-consistent by construction — nothing to cross-validate. It
also costs nothing at this project's scale (`target_metric` is a plain
`varchar`, not a DB enum type, so widening the accepted set is a pure
application-level change — zero migration). `TARGET_UNIT_BY_TARGET_METRIC`
is a lookup table exactly like the existing
`ACTIVITY_TYPE_BY_TARGET_METRIC` — the same established pattern, not a new
one.

**No DTO shape change.** `CreateWeeklyGoalDto.targetMetric` is already
`@IsEnum(WeeklyGoalTargetMetric)`; widening the enum's accepted values is
backward compatible for any client still sending one of the 5 old values.

**Not addressed here, flagged as an accepted, pre-existing gap**: nothing
stops a 1-minute log (DTO already allows `durationMinutes >= 1`) from
counting as a full "pass" toward a session-count goal, the same
honor-system self-report risk `docs/BACKLOG.md`'s points-verification-tier
item already names for the whole points economy. Not solved here —
solving it means solving that broader item, not a one-off minimum-duration
rule bolted onto this feature alone.

## Decision 2 — goal-met becomes "every eligible roster member individually reached the target"; the bonus amount formula is unchanged

**`goalMet` no longer means `SUM(all players' logs) >= targetValue`. It
means every *eligible* current roster member's own logs (summed or
counted, per Decision 1's unit) individually reach `targetValue`.** The
lump-sum bonus mechanic itself (`5 + team-wide minutes logged`, paid once,
idempotency via the row-locked `goalBonusAwardedAt` flag) is **unchanged**
— only the predicate that decides *whether* it fires changes. This mirrors
exactly how ADR-0005's own 2026-07-05 correction worked: "the
transaction/idempotency structure... was already correct; only the
awarded-amount formula... changed." Here it's the reverse — the
transaction/idempotency structure and the awarded-amount formula are both
unchanged; only the crossing predicate changes.

Why keep the team-wide-minutes bonus basis even for a session-count goal:
it's still a meaningful, well-defined number (total minutes actually
trained by the whole team toward that metric/date-range, independent of
how completion is measured) and changing the reward's economics is out of
scope for a fairness fix — the backlog entry's complaint is about who has
to individually train, not about how big the payout is.

### Eligible roster (answers backlog question 2)

A team's live roster is filtered to the players who could plausibly have
logged anything toward this goal:

```
eligible = players WHERE team_id = :teamId
  AND parental_consent_status = 'approved'
  AND team_join_status = 'approved'
  AND (created_at AT TIME ZONE 'Europe/Stockholm')::date <= goal.start_date
```

Consent-pending, revoked, and team-join-pending players are excluded — not
a new restriction, but a direct consequence of an existing one:
`TrainingLogsService.logTraining` already refuses to log training at all
for any player who isn't `parentalConsentStatus: approved` and
`teamJoinStatus: approved` (`assertConsentApproved`/
`assertTeamJoinApproved`). A per-player check that still counted such a
player would make the goal **structurally unwinnable** for the whole team
for as long as one family hasn't completed consent — exactly the outcome
the pooled model never had to worry about and the per-player model must
guard against explicitly. Excluding them from both the numerator and
denominator (not counted as done, not counted as required) is the
simplest rule that avoids that trap.

Players who joined the team *after* `goal.startDate` are excluded from
that goal instance specifically — expecting someone to hit "2 times this
week" who joined on day 6 is neither fair nor generally possible. They
still appear on next week's (or any goal created after their join date's)
eligible roster normally; this only excludes them from a goal that was
already running before they arrived.

**Explicit vacuous-truth guard, required for correctness**: if the
eligible roster is empty (every current player is consent-pending/
just-joined/etc.), `goalMet` is `false`, full stop — "0 of 0 players
done" must never evaluate as complete.

### Simply-inactive players (also answers backlog question 2)

No leniency, and none is needed — this is the entire point of the feature.
An eligible player who never trains that week is why the goal isn't met.
This is the expected, unremarkable failure case, same posture ADR-0005
already gives an unmet pooled goal ("the team simply didn't reach the goal
in time... no special handling needed").

### Departed/erased players (answers backlog question 3)

**Excluded retroactively — and this falls out of the design for free, it
isn't a new mechanism.** The eligible-roster query above is a **live**
query against the current `player` table, re-run every time progress is
computed (dashboard view, history view, and the in-transaction bonus
check) — exactly like `computeTeamProgress` already is today. Per
ADR-0013 Decision 5/6, an erased player's `Player` row (and their
`TrainingLogEntry` rows, via cascade) are hard-deleted, not soft-deleted —
so they simply stop appearing in the eligible-roster query the next time
it runs. There is no ghost row to special-case, no "was required, now
permanently missing" state to represent, because nothing durable ever
recorded "this specific player was required for this specific goal" in
the first place — membership is derived live, same as it always has been.

This is also consistent with an existing, already-accepted behavior:
`progressMinutes` (this ADR renames it `teamBonusBasisMinutes`, Decision
5) is *already* computed live from `TrainingLogEntry`, so an erased
player's minutes already silently drop out of a completed goal's
historical total today, post-erasure, with no special handling. Extending
the same "live, not snapshotted" posture to per-player eligibility is
consistency, not a new inconsistency.

**One accepted, cosmetic consequence, worth naming rather than
discovering later**: because both progress and eligibility are always
live, a goal whose bonus already fired under the *old* pooled rule
(unaffected — bonuses are never clawed back, same precedent as a
`BadgeAward`) may, after this change ships, display `goalMet: false` in
history if its actual per-player logs wouldn't have satisfied the new
rule. This is a display-only artifact of the rule changing underneath
already-settled history, not a data-integrity issue — no points move.

## Decision 3 — response shape: `GoalProgressSummary` gains a per-player breakdown

```ts
export interface PlayerGoalProgress {
  playerId: string;
  screenName: string;
  avatarId: string;
  eligible: boolean;
  // Captain-only — see Decision 4. Always null for a non-captain viewer,
  // regardless of the real reason, including for excluded players.
  exclusionReason:
    | 'joined_after_start'
    | 'consent_pending'
    | 'consent_revoked'
    | 'team_join_pending'
    | null;
  progressValue: number;   // minutes or session count, per targetUnit
  goalMet: boolean;        // always false when eligible is false
}

export interface GoalProgressSummary {
  // ...unchanged: id, teamId, title, description, targetMetric,
  // targetValue, startDate, endDate, status, createdByPlayerId
  targetUnit: 'minutes' | 'sessions';   // NEW, derived, saves the client its own copy of the lookup table
  players: PlayerGoalProgress[];        // NEW — every current roster member, eligible or not
  eligiblePlayerCount: number;          // NEW
  completedPlayerCount: number;         // NEW
  goalMet: boolean;                     // MEANING CHANGED — see Decision 2
  percentComplete: number;              // MEANING CHANGED — completedPlayerCount / eligiblePlayerCount * 100, 0 if eligiblePlayerCount is 0
  teamBonusBasisMinutes: number;        // RENAMED from progressMinutes — team-wide minutes, the bonus basis only, no longer decides goalMet
  bonusAwardedAt: string | null;
  bonusPointsAwarded: number | null;
}
```

**Excluded players still appear in `players[]`** (with `eligible: false`),
rather than being silently dropped from the list. A captain or teammate
looking at "4 of 6 done" needs to see all 6 names to understand who's
missing and why, not wonder where two players went. This is a deliberate
UX/data-shape decision, not an oversight — it's what makes the per-player
list a real replacement for the old single progress bar (backlog question
4) instead of a strictly smaller view of the same information.

`DashboardResponse.weeklyGoal.current` keeps its existing field-inclusion
policy (currently omits `createdByPlayerId`/`teamId`/`bonusPointsAwarded`
from the dashboard's `current` block per the contract's existing example)
— every new field above is included, since the dashboard is exactly where
the per-teammate view needs to render.

**This is a breaking API contract change, not additive.** `goalMet` and
`percentComplete`'s *meaning* changes regardless of field naming, so an
already-shipped mobile client would show a wrong answer even if the field
names were kept identical — silently wrong is worse than a hard
type/shape break. `progressMinutes` is deliberately renamed
(`teamBonusBasisMinutes`) rather than reused with new semantics, so an
un-updated client fails a type check instead of rendering a stale number
under a misleading label. **frontend-developer and backend-developer need
to ship this in lockstep** (same deploy window), the same coordination
already implied by every other Fas 2 contract change in this codebase.

## Decision 4 — privacy: `exclusionReason` is captain-only

**A real finding surfaced while designing the data shape, not a matter
already settled elsewhere.** `consent_pending`/`consent_revoked`/
`team_join_pending` are a teammate's private consent state.
`PlayersService.getRoster`'s existing per-player `consentStatus` field is
already restricted to captain-only callers (`assertIsCaptainOfTeam`); the
aggregate `DashboardResponse.roster` block any team member can see only
exposes team-wide *counts* (`approvedCount`/`pendingCount`/
`revokedCount`), never which specific player is in which state. A
per-goal `players[]` list that exposes `consent_pending` next to a
specific `playerId`/`screenName` for **every** teammate to see would
quietly reopen a visibility boundary this codebase already deliberately
closed elsewhere.

**Decision: `WeeklyGoalService` nulls out `exclusionReason` for any viewer
who isn't the team's captain**, regardless of what the real reason is.
`eligible: false` itself stays visible to everyone (needed for the "not
counted this week" UI treatment) — only the *why* is gated.
`joined_after_start` is not gated (roughly inferable from ordinary team
activity already, not a consent-adjacent fact) but is still delivered
through the same nulled-for-non-captains field for a uniform contract
rather than a second, conditionally-present field. Flagged for
security-reviewer to confirm before ship, same as every other consent-
adjacent surface in this codebase.

## Decision 5 — algorithm changes to `processGoalBonusForLog`

Same transaction, same row lock, same idempotency flag
(`goalBonusAwardedAt`) as ADR-0005 Decision 3 — only steps 3-4 of the
original five-step algorithm change:

1. Load the team's active goal, row-locked. *(unchanged)*
2. Short-circuit: no active goal / log's date out of range / already
   awarded. *(unchanged)*
3. **NEW**: compute the eligible roster (Decision 2's query, same
   `manager`) and the per-player progress map (`GROUP BY player_id`,
   `SUM(duration_minutes)` or `COUNT(*)` depending on
   `TARGET_UNIT_BY_TARGET_METRIC[targetMetric]`, same filters as the
   existing `computeTeamProgress` plus the group-by). If the eligible
   roster is empty, short-circuit (vacuous-truth guard).
4. **CHANGED**: `goalMet = eligible.every(p => (perPlayerMap.get(p.id) ??
   0) >= targetValue)`. If false, nothing else to do — same shape as the
   old `progress < targetValue` branch.
5. **If met**: call the existing, unchanged `computeTeamProgress` for the
   bonus basis, `awardedPoints = 5 + teamBonusBasisMinutes`, same
   `teamPoolService.addPoints` / `goalBonusAwardedAt` update as today.

No new indexes needed — `GROUP BY player_id` over a team's week of logs,
already covered by the existing `idx_training_log_entry_team_id` index,
is cheap at this project's actual roster/log volume ("a handful" of
players and goals per ADR-0005's own framing); adding anything beyond the
existing index would be designing for scale this project doesn't have.

## Consequences

- No new migration, no new column, no data migration on existing
  `challenge` rows — `WeeklyGoalTargetMetric`'s widened value set and the
  new `TARGET_UNIT_BY_TARGET_METRIC` lookup are pure application-level
  additions (Decision 1).
- `WeeklyGoalService.computeTeamProgress` is unchanged and kept (now
  used only as the bonus-amount basis); a new
  `computePerPlayerProgress`-shaped query is added for the completion
  check (Decision 2/5).
- `GoalProgressSummary`/`DashboardResponse.weeklyGoal.current` gain
  `targetUnit`/`players`/`eligiblePlayerCount`/`completedPlayerCount`,
  rename `progressMinutes` → `teamBonusBasisMinutes`, and change the
  meaning of `goalMet`/`percentComplete` — a breaking contract change
  requiring a coordinated frontend/backend deploy (Decision 3).
- A new, narrow privacy boundary is added to a brand-new field
  (`exclusionReason`, captain-only) rather than accidentally widened —
  flagged for security-reviewer confirmation before build (Decision 4).
- Historical (`completed`/`cancelled`) goals may display a different
  `goalMet` after this ships than they did before, for goals whose bonus
  already fired under the old pooled rule — cosmetic only, no points are
  affected (Decision 2).
- Follow-up work, not designed here: **ux-designer** redesigns
  `docs/design/phase2-flows.md` Part 3's team-wide `gold` progress meter
  into a per-teammate completion view (a compact "X of Y lagkamrater
  klara" header for the dashboard card plus a detailed per-player list,
  reusing the `players[]`/`eligiblePlayerCount`/`completedPlayerCount`
  shape above — exact visuals/copy/ordering are that pass's call, not
  fixed here), including the goal-builder screens' need for a unit
  toggle ("minuter" vs. "pass"/"gånger") when creating a goal.
  **backend-developer** implements Decisions 1/2/3/5 against
  `weekly-goal.service.ts`/`weekly-goal-target-metric.enum.ts`/
  `dto/*.ts`, and updates `docs/api/phase2-contract.md` to match.
  **security-reviewer** confirms Decision 4's captain-only gating before
  this ships, and re-confirms the consent-gated-eligibility logic in
  Decision 2 doesn't reintroduce any of ADR-0013's already-closed
  findings (e.g. via the same live-roster query being reused
  incorrectly elsewhere).
