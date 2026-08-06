import {
  daysBetweenExclusive,
  previousDateString,
} from '../time/stockholm-date.util';

// docs/adr/0024-streak-savers.md Decision 1 — a single named constant, same
// convention as redis.service.ts's rate-limit constants. Not a magic number
// scattered through code: it's the default `cap` argument to
// computeStreakUpdate below, and nothing else needs to know it.
export const MAX_BANKED_STREAK_SAVERS = 4;

// docs/adr/0024-streak-savers.md Decision 1 — "1 saver per 7-day streak
// milestone."
const STREAK_SAVER_EARN_INTERVAL_DAYS = 7;

export interface StreakState {
  currentStreakCount: number;
  longestStreakCount: number;
  /** 'YYYY-MM-DD' (Europe/Stockholm calendar day), or null if never trained. */
  lastTrainedDate: string | null;
  /** docs/adr/0024-streak-savers.md Decision 4 — durable, Postgres-only. */
  bankedStreakSaverCount: number;
}

export interface StreakUpdateResult extends StreakState {
  alreadyLoggedToday: boolean;
  /** 0 normally; >0 if a prior gap was bridged by this log (Decision 5). */
  streakSaversSpent: number;
  /** True only if the bank actually increased (false if already at cap). */
  streakSaverEarned: boolean;
}

/**
 * Pure streak-transition function — the "same-day-logging rule" from
 * docs/api/phase1-contract.md, isolated from I/O so it's trivially unit
 * testable (first-ever day, midnight rollover, missed day, repeat same-day
 * log, plus the streak-saver cases from docs/adr/0024-streak-savers.md
 * Decision 5: gap fully covered by banked savers, gap larger than the bank,
 * earning a saver, earning at the cap, spending down to empty) without a
 * database.
 *
 * `today` must already be a Europe/Stockholm 'YYYY-MM-DD' string (see
 * stockholm-date.util.ts) — this function does no timezone handling itself.
 * `cap` defaults to `MAX_BANKED_STREAK_SAVERS`; only ever overridden by
 * tests.
 */
export function computeStreakUpdate(
  state: StreakState,
  today: string,
  cap: number = MAX_BANKED_STREAK_SAVERS,
): StreakUpdateResult {
  if (state.lastTrainedDate === today) {
    // Second (or later) log of the same day: team pool still updates
    // elsewhere, but the streak itself is unchanged, per the contract —
    // and per Decision 5, no saver is spent or earned on a same-day repeat.
    return {
      ...state,
      alreadyLoggedToday: true,
      streakSaversSpent: 0,
      streakSaverEarned: false,
    };
  }

  const yesterday = previousDateString(today);
  let continuesStreak = state.lastTrainedDate === yesterday;
  let streakSaversSpent = 0;

  if (!continuesStreak && state.lastTrainedDate !== null) {
    const missedDayCount = daysBetweenExclusive(state.lastTrainedDate, today);
    // No partial coverage: a gap is either fully bridged by the banked
    // balance or the streak resets — same "boring, unambiguous" instinct as
    // the rest of this codebase's derived state (docs/adr/0024-streak-
    // savers.md Decision 5).
    if (missedDayCount > 0 && missedDayCount <= state.bankedStreakSaverCount) {
      continuesStreak = true;
      streakSaversSpent = missedDayCount;
    }
  }

  const nextCurrentStreak = continuesStreak ? state.currentStreakCount + 1 : 1;
  const nextLongestStreak = Math.max(
    state.longestStreakCount,
    nextCurrentStreak,
  );

  const wouldEarnSaver =
    nextCurrentStreak % STREAK_SAVER_EARN_INTERVAL_DAYS === 0;
  const bankedAfterSpend = state.bankedStreakSaverCount - streakSaversSpent;
  // Earning past the cap is a no-op (Decision 1) — no event row, no error,
  // reflected here by streakSaverEarned staying false when already at cap.
  const streakSaverEarned = wouldEarnSaver && bankedAfterSpend < cap;
  const bankedStreakSaverCount = Math.min(
    bankedAfterSpend + (streakSaverEarned ? 1 : 0),
    cap,
  );

  return {
    currentStreakCount: nextCurrentStreak,
    longestStreakCount: nextLongestStreak,
    lastTrainedDate: today,
    bankedStreakSaverCount,
    alreadyLoggedToday: false,
    streakSaversSpent,
    streakSaverEarned,
  };
}

/**
 * The `count` calendar days immediately preceding `today`, chronological
 * (oldest first) — the exact set of missed days a `streakSaversSpent`-sized
 * bridge covers, for writing one `StreakSaverEvent` row per covered date
 * (docs/adr/0024-streak-savers.md Decision 4: "one row per saver, not one
 * row per resolution"). Only ever called with `count === streakSaversSpent`
 * from `computeStreakUpdate`'s own result, which is capped at
 * `MAX_BANKED_STREAK_SAVERS` — so this stays a small, bounded loop even
 * though it's less cheap than `daysBetweenExclusive`'s O(1) count.
 */
export function streakSaverCoveredDates(
  today: string,
  count: number,
): string[] {
  const dates: string[] = [];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    cursor = previousDateString(cursor);
    dates.unshift(cursor);
  }
  return dates;
}
