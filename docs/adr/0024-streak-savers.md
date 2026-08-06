# 0024 - Streak savers: bounded, auto-applied grace days for the individual streak

## Status

Proposed — 2026-08-06.

## Context

Project owner, 2026-08-05, `docs/BACKLOG.md` ("Streak savers"), verbatim:
*"if they missed one day for some reason like if they were sick or on
vacation, they can then use a Streak saver, they got a new one for every 7
days streak they get... so they can reach 365 days streak or something."*
And, explicitly decoupling this from the team point pool: *"a streak has
nothing to do with points... our tool to remind them to keep up."*

**What the current implementation actually does (confirmed by reading the
code, not assumed):**

- Streak state is three denormalized columns on `Player`
  (`current_streak_count`, `longest_streak_count`, `last_trained_date`),
  Postgres-durable per ADR-0002, with a fast Redis copy only for the
  per-team leaderboard sorted set and the "already logged today"
  idempotency check (`RedisService`).
- The break/continue transition is a **pure function**,
  `computeStreakUpdate` (`backend/src/common/streak/streak.util.ts`),
  invoked from exactly one place: `TrainingLogsService.logTraining`, inside
  the same Postgres transaction as the `TrainingLogEntry` insert, guarded
  by a `SELECT ... FOR UPDATE` row lock (`findByIdForUpdate`) that already
  serializes concurrent requests for the same player.
- **There is no cron job.** Unlike `ClipRetentionService`/
  `AccountErasureSweepService` (`@nestjs/schedule`, `@Cron`), nothing ever
  proactively walks players at midnight and resets a broken streak. A
  streak "breaks" only in the sense that the *next* `TrainingLogEntry` for
  that player, whenever it happens, computes `currentStreakCount = 1`
  instead of `+1` if `last_trained_date` isn't yesterday.
- **`GET /api/v1/players/me` (`PlayersController.getMe`) does not
  recompute anything either** — it returns the stored
  `current_streak_count`/`last_trained_date` as-is. So today, if a player
  misses a day, the home screen keeps showing their old streak count,
  unchanged, until they either train again (streak resets in the response
  of that log) or never do (it just stays visibly stale forever). This is
  an existing, accepted characteristic of the app, not a bug this ADR
  needs to fix — but it's the ground truth this design has to stay
  consistent with rather than silently overriding with a new
  mutate-on-read pattern.

This ADR needs to resolve three judgment calls the backlog entry flags as
open (cap on banked savers, automatic vs. player-chosen spend, whether/
where a spend is celebrated), plus the data model and the
write-path/race-condition question, while keeping the mechanic entirely
inside the **individual** streak system per the owner's own explicit
"nothing to do with points" framing.

## Decision 1 — Cap the bank at 4; no cap is a design flaw, not a feature

The owner's own example (14-day streak → 2 savers, "1 per 7 days") implies
no named ceiling, but taken literally over a real long streak that's not
tenable: a genuine 365-day uninterrupted streak would bank
`floor(365 / 7) = 52` savers under a naive uncapped rule. That would let a
player who trained hard for a year then vanish for **up to 52 consecutive
days** and still have the app present their streak as unbroken — directly
contradicting the owner's own stated purpose ("our tool to remind them to
keep up"). An uncapped bank isn't a generous version of the feature, it's
a version that eventually stops doing the one thing the feature exists to
do.

**Decision: cap the bank at 4 banked savers**, a single named constant
(`MAX_BANKED_STREAK_SAVERS`), not a magic number scattered through code —
same convention as `redis.service.ts`'s existing rate-limit constants.
Reasoning for 4 specifically: it covers a genuinely bad stretch (a real
illness, a week's holiday minus a couple of training-friendly days)
without letting the safety net become large enough to functionally replace
showing up. It's deliberately in the same neighborhood as Duolingo's own
well-known 2-freeze default (SkillStreak has no monetization angle to
weigh here, unlike Duolingo's paid extra freezes, so there's no reason to
set it as low as 2 — 4 is generous but still bounded). This cap does
double duty (see Decision 5): because a gap can only ever be bridged by
spending currently-banked savers, capping the bank also caps the longest
single gap the mechanic can bridge, with no separate "max consecutive
missed days" rule needed.

Earning past the cap is simply a no-op: if a player hits a fresh 7-day
milestone while already banked at 4, nothing is recorded (no event row,
no error) — there's nothing to grant. Not treated as a bug or an edge case
needing special handling.

## Decision 2 — Automatic, silent spend; no confirmation prompt

**Decision: a saver is spent automatically the first time the gap is
resolved (see Decision 5 for exactly when that is), with no yes/no prompt
to the player.**

Reasoning:

- The owner's own framing — "our tool to remind them to keep up" — casts
  this as reassurance infrastructure, not a decision the player needs to
  make under pressure. A 9–13-year-old opening the app after being sick,
  and being immediately confronted with a binary "spend a saver? yes/no"
  choice, turns a calming mechanic into a small, unnecessary dilemma at
  exactly the moment the feature exists to remove one.
- A player-chosen model also needs a real answer for "what happens if they
  decline" — does the saver stay banked (fine) but then does the streak
  just... break anyway, contradicting what the prompt already told them
  was possible? That's avoidable complexity for a feature whose entire
  point is friction reduction.
- Agency (the other side of this trade-off) doesn't require an
  in-the-moment choice to be real — it's satisfied by **visibility**:
  the banked count is always shown on the streak card (Decision 3), and a
  spend is never invisible after the fact.

## Decision 3 — A real "streak saved" moment, surfaced twice, no push notification

Two distinct UI moments, both tied to Decision 5's mechanics rather than
invented separately:

1. **A persistent, non-alarming banner while a gap is open but still
   coverable** — shown on `GET /players/me`'s response whenever
   `last_trained_date` is neither today nor yesterday but the missed-day
   count is still within the banked balance (a **live, non-persisted
   preview** — see Decision 5, nothing is written by this read). Copy
   direction (ux-designer's call): reassuring and still forward-nudging,
   e.g. *"We'll use N savers to protect your streak — log today to keep it
   going!"* — this keeps the reminder function intact rather than fully
   letting the player off the hook.
2. **A one-time celebratory beat, exactly once, the moment the spend
   actually commits** — carried in `TrainingLogResponse.streak
   .streakSaverSpent` (>0) the next time the player logs training, the
   same mechanism `goalBonus` already uses in that same response for its
   own celebratory moment. This is the definitive "streak saved!" toast/
   animation.

**No push notification.** This app has no push-notification
infrastructure at all today (no Expo push tokens, no `expo-notifications`
usage anywhere in `mobile/src`, no server-side send path) — building one
purely for this feature would be new infrastructure, a new child-directed
messaging surface, and a new consent/permissions question, all out of
scope for what's meant to be a small mechanic change. In-app-only also
avoids turning a calm mechanic into a re-engagement push, which nothing
about this feature request asked for.

## Decision 4 — Data model: one new `Player` column, one new append-only table

Follows this app's standing pattern exactly: a denormalized counter for
fast reads (like `current_streak_count`), backed by an append-only event
table for audit/history (like `TrainingLogEntry` behind the streak
counters, `ParentalConsentRecord` behind consent status).

```sql
ALTER TABLE "player"
  ADD "banked_streak_saver_count" integer NOT NULL DEFAULT 0;
  -- Durable balance, Postgres (same "survive a Redis flush" reasoning
  -- ADR-0002 already applies to current_streak_count/longest_streak_count).
  -- Existing rows default to 0 — no backfill needed, no behavior change
  -- for any player until they next earn one post-rollout.

CREATE TABLE "streak_saver_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "player_id" uuid NOT NULL REFERENCES "player"("id") ON DELETE CASCADE,
  "event_type" varchar NOT NULL, -- enum('earned', 'spent') at the entity level
  "banked_balance_after" integer NOT NULL,
  -- Only set for event_type = 'earned':
  "training_log_entry_id" uuid NULL REFERENCES "training_log_entry"("id") ON DELETE SET NULL,
  -- Only set for event_type = 'spent':
  "covered_date" date NULL, -- the missed calendar day this one saver covered
  "resolved_by_training_log_entry_id" uuid NULL REFERENCES "training_log_entry"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "IDX_streak_saver_event_player" ON "streak_saver_event" ("player_id", "created_at");
```

- One row per saver, not one row per resolution — a 3-day gap bridged by 3
  banked savers writes 3 `spent` rows (one `covered_date` each), directly
  matching the "1 saver = 1 missed day" unit the owner's own example uses,
  and matching how `earned` rows already work (1 row per 7-day milestone).
- This table is optional in the sense that `banked_streak_saver_count`
  alone is enough to run the mechanic — it exists for the same reason
  `ParentalConsentRecord` exists alongside a single status field (ADR-0002
  addendum §1): "why did my streak reset" / "why do I only have 1 saver
  left" needs to be answerable from history, not just from the current
  number, and it's cheap to add now versus reconstructing later.
- Deliberately **not** on `Player` itself, and deliberately **not**
  reusing `TrainingLogEntry` — a saver spend is not a training event (no
  activity happened on the covered day), and it must never be mistaken for
  one (see Decision 6).

## Decision 5 — Still computed on next write, never on read; the read path only ever previews

**Confirmed from Context: streak transitions are computed exactly once,
inside `TrainingLogsService.logTraining`'s existing transaction, guarded
by the existing row lock.** The saver mechanic extends that same function
and stays in that same place — it does not move to a cron job (this app
deliberately has none for streak state) and it does not move onto the read
path either.

**`computeStreakUpdate` gains one input and three new output fields:**

```ts
export interface StreakState {
  currentStreakCount: number;
  longestStreakCount: number;
  lastTrainedDate: string | null;
  bankedStreakSaverCount: number; // NEW
}

export interface StreakUpdateResult extends StreakState {
  alreadyLoggedToday: boolean;
  streakSaversSpent: number;   // NEW — 0 normally; >0 if a prior gap was bridged by this log
  streakSaverEarned: boolean;  // NEW — true only if the bank actually increased (false if already at cap)
}

// Sketch, not final implementation:
function computeStreakUpdate(state, today, cap = 4): StreakUpdateResult {
  if (state.lastTrainedDate === today) return { ...state, alreadyLoggedToday: true, streakSaversSpent: 0, streakSaverEarned: false };

  const yesterday = previousDateString(today);
  let continuesStreak = state.lastTrainedDate === yesterday;
  let streakSaversSpent = 0;

  if (!continuesStreak && state.lastTrainedDate !== null) {
    const missedDayCount = daysBetweenExclusive(state.lastTrainedDate, today); // new date util, same file as previousDateString
    // No partial coverage: a gap is either fully bridged or the streak resets, same
    // "boring, unambiguous" instinct as the rest of this codebase's derived state.
    if (missedDayCount > 0 && missedDayCount <= state.bankedStreakSaverCount) {
      continuesStreak = true;
      streakSaversSpent = missedDayCount;
    }
  }

  const nextCurrentStreak = continuesStreak ? state.currentStreakCount + 1 : 1;
  const nextLongestStreak = Math.max(state.longestStreakCount, nextCurrentStreak);
  const wouldEarn = nextCurrentStreak % 7 === 0;
  const afterSpend = state.bankedStreakSaverCount - streakSaversSpent;
  const streakSaverEarned = wouldEarn && afterSpend < cap;
  const bankedStreakSaverCount = Math.min(afterSpend + (streakSaverEarned ? 1 : 0), cap);

  return { currentStreakCount: nextCurrentStreak, longestStreakCount: nextLongestStreak,
    lastTrainedDate: today, bankedStreakSaverCount, alreadyLoggedToday: false,
    streakSaversSpent, streakSaverEarned };
}
```

`TrainingLogsService.logTraining` passes `bankedStreakSaverCount` in
alongside the existing three fields when calling this, and
`PlayersService.updateStreakFields` persists the returned
`bankedStreakSaverCount` plus writes the corresponding `StreakSaverEvent`
row(s) (one `spent` row per covered date if `streakSaversSpent > 0`, one
`earned` row if `streakSaverEarned`) — all inside the same transaction, no
new I/O, same "one more step in the same transaction" pattern ADR-0005's
goal-bonus check and ADR-0021's system-message insert already establish
for this kind of same-transaction side effect.

**Why this introduces no new race condition:** the existing
`findByIdForUpdate` row lock already serializes every concurrent
`logTraining` call for a given player around the whole transaction —
extending what that transaction computes doesn't weaken that guarantee.
Two concurrent training-log requests for the same player already can't
both "win" the streak transition today; they can't both spend the same
saver for the same reason.

**Why `GET /players/me` stays read-only rather than gaining the same
mutation:** it's this app's single hottest read endpoint, called on every
app open. Making it transactional/lock-acquiring purely to give the
"streak saved" banner (Decision 3) a proactive trigger point would add
lock contention to a hot path for a cosmetic win, and would break this
app's existing "reads never mutate streak state" invariant for the first
time. Instead, `getMe` computes the **same pure function**, read-only,
against the live stored state, and simply **discards the result** without
persisting it — safe to call any number of times, safe to run
concurrently with anything, and guaranteed to agree with whatever the next
real write later commits, since it's the same deterministic function fed
the same inputs. The only user-visible effect of never persisting this
preview is that it recomputes fresh on every open, which is exactly what's
wanted for a live "N days missed, still coverable" banner.

## Decision 6 — Stays strictly inside the individual streak; zero interaction with the team pool

Confirmed against `docs/PROJECT.md`'s individual/team split and the
owner's own explicit note ("a streak has nothing to do with points"):

- **No change to `TeamSeasonPot`, `pointsForTrainingLog`, the team-pool
  Redis gauge, or any weekly-goal logic.** A saver-covered missed day
  earns the team **zero** points — nothing was actually trained that day.
- **No synthetic/backdated `TrainingLogEntry` row is ever written for a
  covered day.** This is stated as an explicit guardrail, not left
  implicit: it would be the obvious-looking shortcut to "make the record
  whole," and it would be wrong twice over — it would falsely credit the
  team pool for a day nothing happened, and it would corrupt
  `TrainingLogEntry`'s meaning as "an actual logged training event"
  (ADR-0002's own stated reason for keeping it append-only and
  authoritative). A covered gap is represented **only** by
  `StreakSaverEvent` rows plus the denormalized `Player` counters — never
  by a fake training log.
- **The per-team streak leaderboard (`leaderboard:team:{teamId}:streak`,
  Redis sorted set) needs no schema change** — it's already just keyed by
  `currentStreakCount`, which a saver-bridged continuation still updates
  normally via the existing `RedisService.updateLeaderboard` call after
  the transaction commits.
- **No new Redis key for the banked balance itself.** `GET /players/me`
  already reads streak fields straight from Postgres, not from a Redis
  copy — there's no existing precedent to break by keeping
  `banked_streak_saver_count` the same way, and Decision 5 already
  establishes it's never touched on the read path anyway.

## API sketch (extends `docs/api/phase1-contract.md`/`phase2-contract.md`)

```
POST /api/v1/training-logs   (TrainingLogResponse, additive fields only)
  streak: {
    currentStreakCount, longestStreakCount, alreadyLoggedToday,  // unchanged
    bankedStreakSaverCount: number,   // NEW — post-transaction balance
    streakSaverSpent: number,         // NEW — 0 normally; >0 = the "streak saved!" moment, Decision 3
    streakSaverEarned: boolean,       // NEW
  }

GET /api/v1/players/me   (PlayerMeResponse, additive fields only)
  streak: {
    currentStreakCount, longestStreakCount, lastTrainedDate, alreadyLoggedToday, // unchanged
    bankedStreakSaverCount: number,   // NEW — always present, drives the streak-card badge
    pendingStreakGap: {               // NEW — null unless a gap currently exists; never persisted (Decision 5)
      missedDayCount: number,
      coverableWithBankedSavers: boolean,
    } | null,
  }
```

No new endpoints are required for v1 — matches this app's existing "no
second round-trip" principle already stated in `players.controller.ts`. A
`GET /players/me/streak-savers` history screen (rendering `StreakSaverEvent`
rows) is a plausible nice-to-have but not needed to ship the mechanic;
left to frontend-developer/ux-designer to propose if wanted.

## Consequences

- **Schema**: one new `player.banked_streak_saver_count` column (default
  0, no backfill needed — every existing player starts at 0 with no
  behavior change until they next earn one); one new append-only
  `streak_saver_event` table.
- **`computeStreakUpdate` gains one input (`bankedStreakSaverCount`) and
  three outputs (`streakSaversSpent`, `streakSaverEarned`, updated
  `bankedStreakSaverCount`)** — still a pure, unit-testable function, same
  file (`backend/src/common/streak/streak.util.ts`), same "first-ever day,
  midnight rollover, missed day, repeat same-day log" testing style the
  existing spec already uses, extended with gap-bridged/gap-too-large/
  bank-at-cap cases.
- **`TrainingLogsService.logTraining`** passes the extra input and
  persists the extra outputs inside its existing transaction; no change to
  its consent-gate ordering, its Postgres-then-Redis write-path ordering,
  or its row-locking.
- **`PlayersController.getMe`** gains a non-persisted preview computation
  and two new response fields; no new lock, no new transaction, no change
  to its existing shape otherwise.
- **Rollout is inherently safe**: a player with a long pre-existing gap at
  deploy time (or any gap before they've earned their first saver) simply
  resets to a 1-day streak on their next log, exactly as today —
  `bankedStreakSaverCount` starts at 0 for everyone, so nothing changes
  until the mechanic has had a chance to actually grant a saver.
- **Dormant hook worth naming, not building now**: `BadgeAward`'s
  `STREAK_MILESTONE` trigger reason (`badges/badge-trigger-reason.enum.ts`)
  already exists but isn't wired to anything yet — a future pass could
  award a small badge at the same 7-day mark a saver is earned, reusing
  this feature's own milestone check. Not part of this ADR; flagged so
  whoever builds it later doesn't duplicate the "is this a fresh multiple
  of 7" logic in two places.
- **Hand-off**:
  - **backend-developer**: the migration, the `computeStreakUpdate`
    extension + spec cases, `StreakSaverEvent` entity/repository, the
    `TrainingLogsService`/`PlayersController` wiring above, and the
    `phase1-contract.md`/`phase2-contract.md` doc updates to match.
  - **ux-designer**: the streak-card banked-saver badge, the pending-gap
    banner copy (Decision 3.1), and the one-time "streak saved!" toast/
    animation (Decision 3.2) — exact Swedish copy and visuals, not decided
    here.
  - **frontend-developer**: rendering the two new response fields on the
    home screen, and the log-response-driven celebratory toast (same
    pattern already used for `goalBonus`).
  - No security-reviewer pass is expected to be required at more than a
    light/self-certified level — no new child-data category, no new
    external party, no new write path outside the already-reviewed
    training-log transaction, and no new consent surface (per the backlog
    entry's own framing). Flagged here rather than silently assumed, so
    it's a stated judgment call and not an omission.
