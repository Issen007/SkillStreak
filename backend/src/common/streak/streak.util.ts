import { previousDateString } from '../time/stockholm-date.util';

export interface StreakState {
  currentStreakCount: number;
  longestStreakCount: number;
  /** 'YYYY-MM-DD' (Europe/Stockholm calendar day), or null if never trained. */
  lastTrainedDate: string | null;
}

export interface StreakUpdateResult extends StreakState {
  alreadyLoggedToday: boolean;
}

/**
 * Pure streak-transition function — the "same-day-logging rule" from
 * docs/api/phase1-contract.md, isolated from I/O so it's trivially unit
 * testable (first-ever day, midnight rollover, missed day, repeat same-day
 * log) without a database.
 *
 * `today` must already be a Europe/Stockholm 'YYYY-MM-DD' string (see
 * stockholm-date.util.ts) — this function does no timezone handling itself.
 */
export function computeStreakUpdate(
  state: StreakState,
  today: string,
): StreakUpdateResult {
  if (state.lastTrainedDate === today) {
    // Second (or later) log of the same day: team pool still updates
    // elsewhere, but the streak itself is unchanged, per the contract.
    return { ...state, alreadyLoggedToday: true };
  }

  const yesterday = previousDateString(today);
  const continuesStreak = state.lastTrainedDate === yesterday;
  const nextCurrentStreak = continuesStreak ? state.currentStreakCount + 1 : 1;
  const nextLongestStreak = Math.max(
    state.longestStreakCount,
    nextCurrentStreak,
  );

  return {
    currentStreakCount: nextCurrentStreak,
    longestStreakCount: nextLongestStreak,
    lastTrainedDate: today,
    alreadyLoggedToday: false,
  };
}
