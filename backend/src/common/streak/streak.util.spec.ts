import { computeStreakUpdate, StreakState } from './streak.util';

const baseState = (overrides: Partial<StreakState> = {}): StreakState => ({
  currentStreakCount: 0,
  longestStreakCount: 0,
  lastTrainedDate: null,
  ...overrides,
});

describe('computeStreakUpdate', () => {
  it("starts a streak at 1 on a player's first-ever logged day", () => {
    const result = computeStreakUpdate(baseState(), '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 1,
      longestStreakCount: 1,
      lastTrainedDate: '2026-07-03',
      alreadyLoggedToday: false,
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
      alreadyLoggedToday: false,
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

  it('resets the streak to 1 after a missed day', () => {
    const state = baseState({
      currentStreakCount: 6,
      longestStreakCount: 9,
      lastTrainedDate: '2026-06-30', // two days before today, one day missed
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 1,
      longestStreakCount: 9, // longest record is preserved, not reset
      lastTrainedDate: '2026-07-03',
      alreadyLoggedToday: false,
    });
  });

  it('leaves streak counters unchanged on a second same-day log', () => {
    const state = baseState({
      currentStreakCount: 4,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
    });

    const result = computeStreakUpdate(state, '2026-07-03');

    expect(result).toEqual({
      currentStreakCount: 4,
      longestStreakCount: 9,
      lastTrainedDate: '2026-07-03',
      alreadyLoggedToday: true,
    });
  });
});
