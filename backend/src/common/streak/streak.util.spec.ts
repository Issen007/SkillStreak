import {
  computeStreakUpdate,
  MAX_BANKED_STREAK_SAVERS,
  StreakState,
  streakSaverCoveredDates,
} from './streak.util';

const baseState = (overrides: Partial<StreakState> = {}): StreakState => ({
  currentStreakCount: 0,
  longestStreakCount: 0,
  lastTrainedDate: null,
  bankedStreakSaverCount: 0,
  ...overrides,
});

describe('computeStreakUpdate', () => {
  it("starts a streak at 1 on a player's first-ever logged day", () => {
    const result = computeStreakUpdate(baseState(), '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 1,
      longestStreakCount: 1,
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 0,
      alreadyLoggedToday: false,
      streakSaversSpent: 0,
      streakSaverEarned: false,
    });
  });

  it('increments the streak when the previous log was exactly yesterday (midnight rollover)', () => {
    const state = baseState({
      currentStreakCount: 4,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-02',
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 5,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 0,
      alreadyLoggedToday: false,
      streakSaversSpent: 0,
      streakSaverEarned: false,
    });
  });

  it('raises longestStreakCount once currentStreakCount overtakes it', () => {
    const state = baseState({
      currentStreakCount: 9,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-02',
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result.currentStreakCount).toBe(10);
    expect(result.longestStreakCount).toBe(10);
  });

  it('resets the streak to 1 after a missed day with no banked savers', () => {
    const state = baseState({
      currentStreakCount: 6,
      longestStreakCount: 9,
      lastTrainedDate: '2026-06-30', // 2 days missed (07-01, 07-02), no banked savers to cover them
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 1,
      longestStreakCount: 9, // longest record is preserved, not reset
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 0,
      alreadyLoggedToday: false,
      streakSaversSpent: 0,
      streakSaverEarned: false,
    });
  });

  it('leaves streak counters unchanged on a second same-day log', () => {
    const state = baseState({
      currentStreakCount: 4,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 2,
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 4,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 2,
      alreadyLoggedToday: true,
      streakSaversSpent: 0,
      streakSaverEarned: false,
    });
  });

  // docs/adr/0024-streak-savers.md Decision 5 — streak-saver cases.

  it('bridges a gap fully covered by banked savers, continuing the streak', () => {
    const state = baseState({
      currentStreakCount: 6,
      longestStreakCount: 9,
      lastTrainedDate: '2026-06-30', // 2 days missed (07-01, 07-02)
      bankedStreakSaverCount: 2,
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 7,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 1, // 2 spent (2 -> 0), but hitting the 7-day mark earns one back (0 -> 1)
      alreadyLoggedToday: false,
      streakSaversSpent: 2,
      streakSaverEarned: true,
    });
  });

  it('resets the streak when the gap is larger than the banked balance (no partial coverage)', () => {
    const state = baseState({
      currentStreakCount: 6,
      longestStreakCount: 9,
      lastTrainedDate: '2026-06-30', // 2 days missed
      bankedStreakSaverCount: 1, // not enough to cover 2 missed days
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 1,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
      bankedStreakSaverCount: 1, // untouched — nothing was spent
      alreadyLoggedToday: false,
      streakSaversSpent: 0,
      streakSaverEarned: false,
    });
  });

  it('earns a saver on a fresh 7-day milestone', () => {
    const state = baseState({
      currentStreakCount: 6,
      longestStreakCount: 6,
      lastTrainedDate: '2026-07-02',
      bankedStreakSaverCount: 1,
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result.currentStreakCount).toBe(7);
    expect(result.streakSaverEarned).toBe(true);
    expect(result.bankedStreakSaverCount).toBe(2);
  });

  it('does not earn a saver (and writes no event) when already at the cap', () => {
    const state = baseState({
      currentStreakCount: 6,
      longestStreakCount: 6,
      lastTrainedDate: '2026-07-02',
      bankedStreakSaverCount: MAX_BANKED_STREAK_SAVERS,
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result.currentStreakCount).toBe(7);
    expect(result.streakSaverEarned).toBe(false);
    expect(result.bankedStreakSaverCount).toBe(MAX_BANKED_STREAK_SAVERS);
  });

  it('spends savers down to exactly empty when the gap equals the full banked balance', () => {
    const state = baseState({
      currentStreakCount: 10,
      longestStreakCount: 10,
      lastTrainedDate: '2026-06-29', // 3 days missed (06-30, 07-01, 07-02)
      bankedStreakSaverCount: 3,
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result.streakSaversSpent).toBe(3);
    expect(result.currentStreakCount).toBe(11); // continues, not a 7-day multiple
    expect(result.streakSaverEarned).toBe(false);
    expect(result.bankedStreakSaverCount).toBe(0);
  });
});

describe('streakSaverCoveredDates', () => {
  it('returns the N calendar days immediately preceding today, oldest first', () => {
    expect(streakSaverCoveredDates('2026-07-03', 2)).toEqual([
      '2026-07-01',
      '2026-07-02',
    ]);
  });

  it('returns an empty array for zero savers spent', () => {
    expect(streakSaverCoveredDates('2026-07-03', 0)).toEqual([]);
  });

  it('handles a month rollover', () => {
    expect(streakSaverCoveredDates('2026-07-02', 3)).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ]);
  });
});
