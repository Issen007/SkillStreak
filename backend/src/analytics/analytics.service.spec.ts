import { fillMissingDays } from './analytics.service';

describe('fillMissingDays', () => {
  const today = new Date('2026-08-10T12:00:00.000Z');

  it('plots a quiet day as a zero rather than skipping it', () => {
    const filled = fillMissingDays([{ day: '2026-08-10', value: 4 }], 3, today);

    // Skipping the gap would draw a straight line across it, which reads
    // as "steady" when the truth is "nobody came" — and on a launch chart
    // the empty days are the interesting ones.
    expect(filled).toEqual([
      { day: '2026-08-08', value: 0 },
      { day: '2026-08-09', value: 0 },
      { day: '2026-08-10', value: 4 },
    ]);
  });

  it('returns exactly one point per day in the window, oldest first', () => {
    const filled = fillMissingDays([], 30, today);

    expect(filled).toHaveLength(30);
    expect(filled[0].day).toBe('2026-07-12');
    expect(filled[29].day).toBe('2026-08-10');
  });

  it('keeps known values and does not double-count them', () => {
    const filled = fillMissingDays(
      [
        { day: '2026-08-09', value: 7 },
        { day: '2026-08-10', value: 2 },
      ],
      2,
      today,
    );

    expect(filled).toEqual([
      { day: '2026-08-09', value: 7 },
      { day: '2026-08-10', value: 2 },
    ]);
  });

  it('ignores points outside the window rather than shifting them in', () => {
    const filled = fillMissingDays(
      [
        { day: '2026-01-01', value: 99 },
        { day: '2026-08-10', value: 1 },
      ],
      2,
      today,
    );

    expect(filled).toEqual([
      { day: '2026-08-09', value: 0 },
      { day: '2026-08-10', value: 1 },
    ]);
  });
});
