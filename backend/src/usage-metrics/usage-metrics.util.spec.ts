import {
  POT_GROWTH_HISTOGRAM_BUCKETS,
  STREAK_HISTOGRAM_BUCKETS,
} from './usage-metrics.constants';
import { TeamSizeBucketFigures } from './usage-metrics.types';
import {
  applyMinimumPopulationFloor,
  buildHistogram,
  buildStreakHistogram,
  computeTeamPoolGrowth,
  fillWeeklySeries,
  median,
  percentOf,
} from './usage-metrics.util';

// docs/adr/0020-usage-analytics-product-metrics.md — the pure half of the
// module: Decision 1's fixed histogram buckets and, most importantly,
// Decision 3's security-reviewer-required minimum-population floor.
describe('usage-metrics.util', () => {
  describe('percentOf', () => {
    it('rounds to a whole percent', () => {
      expect(percentOf(1, 3)).toBe(33);
      expect(percentOf(2, 3)).toBe(67);
    });

    it('is 0 (not NaN) on an empty denominator', () => {
      expect(percentOf(0, 0)).toBe(0);
    });
  });

  describe('buildStreakHistogram', () => {
    // Decision 1: "a histogram of Player.currentStreakCount/
    // longestStreakCount into fixed buckets (0, 1-3, 4-7, 8-14, 15-30,
    // 31+) — never a sorted list of individual values."
    it('bins streak-value counts into the ADR"s six fixed buckets, in order', () => {
      const bars = buildStreakHistogram([
        { streakCount: 0, playerCount: 7 },
        { streakCount: 1, playerCount: 2 },
        { streakCount: 3, playerCount: 1 },
        { streakCount: 4, playerCount: 5 },
        { streakCount: 14, playerCount: 1 },
        { streakCount: 30, playerCount: 2 },
        { streakCount: 31, playerCount: 1 },
        { streakCount: 900, playerCount: 1 },
      ]);

      expect(bars).toEqual([
        { bucket: '0', count: 7 },
        { bucket: '1-3', count: 3 },
        { bucket: '4-7', count: 5 },
        { bucket: '8-14', count: 1 },
        { bucket: '15-30', count: 2 },
        { bucket: '31+', count: 2 },
      ]);
    });

    it('keeps every bar present at zero rather than omitting it', () => {
      const bars = buildStreakHistogram([]);
      expect(bars).toHaveLength(STREAK_HISTOGRAM_BUCKETS.length);
      expect(bars.every((bar) => bar.count === 0)).toBe(true);
    });

    it('bins each boundary value into the lower bucket (3/4, 7/8, 14/15, 30/31)', () => {
      const at = (value: number) =>
        buildStreakHistogram([{ streakCount: value, playerCount: 1 }])
          .filter((bar) => bar.count === 1)
          .map((bar) => bar.bucket);

      expect(at(3)).toEqual(['1-3']);
      expect(at(4)).toEqual(['4-7']);
      expect(at(7)).toEqual(['4-7']);
      expect(at(8)).toEqual(['8-14']);
      expect(at(14)).toEqual(['8-14']);
      expect(at(15)).toEqual(['15-30']);
      expect(at(30)).toEqual(['15-30']);
      expect(at(31)).toEqual(['31+']);
    });
  });

  describe('computeTeamPoolGrowth', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');

    it('reports points/week per active pot as a distribution, never a per-pot list', () => {
      // Four weeks exactly (2026-07-04 -> 2026-08-01).
      const growth = computeTeamPoolGrowth(
        [
          { pointsTotal: 400, seasonStartDate: '2026-07-04' },
          { pointsTotal: 2000, seasonStartDate: '2026-07-04' },
          { pointsTotal: 0, seasonStartDate: '2026-07-04' },
        ],
        now,
      );

      expect(growth.activePotCount).toBe(3);
      // 100, 500, 0 points/week -> median 100.
      expect(growth.medianPointsPerWeek).toBe(100);
      expect(growth.histogram).toEqual([
        { bucket: '0', count: 1 },
        { bucket: '1-99', count: 0 },
        { bucket: '100-499', count: 1 },
        { bucket: '500-1499', count: 1 },
        { bucket: '1500+', count: 0 },
      ]);
      expect(Object.keys(growth)).toEqual([
        'activePotCount',
        'medianPointsPerWeek',
        'histogram',
      ]);
    });

    it('floors elapsed time at one week so a days-old season cannot report an inflated rate', () => {
      const growth = computeTeamPoolGrowth(
        [{ pointsTotal: 210, seasonStartDate: '2026-07-30' }],
        now,
      );
      // 2 days elapsed, but divided by 1 week, not by 2/7 of one.
      expect(growth.medianPointsPerWeek).toBe(210);
    });

    it('is empty-safe when no pot is active', () => {
      const growth = computeTeamPoolGrowth([], now);
      expect(growth.activePotCount).toBe(0);
      expect(growth.medianPointsPerWeek).toBe(0);
      expect(growth.histogram).toHaveLength(
        POT_GROWTH_HISTOGRAM_BUCKETS.length,
      );
    });
  });

  describe('median', () => {
    it('averages the two middle values on an even-length input', () => {
      expect(median([1, 2, 3, 10])).toBe(2.5);
    });

    it('is 0 on an empty input', () => {
      expect(median([])).toBe(0);
    });
  });

  describe('fillWeeklySeries', () => {
    const windowStart = new Date('2026-07-02T06:00:00.000Z');
    const now = new Date('2026-08-01T06:00:00.000Z');

    it('fills quiet weeks with 0 instead of skipping them', () => {
      const series = fillWeeklySeries(
        [
          { weekStart: '2026-07-06', count: 4 },
          { weekStart: '2026-07-27', count: 1 },
        ],
        windowStart,
        now,
      );

      expect(series).toEqual([
        // First and last are only partly inside the window (it starts
        // Thursday 2026-07-02 and the run is Saturday 2026-08-01), so their
        // lower counts are windowing, not a usage dip — see the `partial`
        // flag's own comment.
        { weekStart: '2026-06-29', count: 0, partial: true },
        { weekStart: '2026-07-06', count: 4, partial: false },
        { weekStart: '2026-07-13', count: 0, partial: false },
        { weekStart: '2026-07-20', count: 0, partial: false },
        { weekStart: '2026-07-27', count: 1, partial: true },
      ]);
    });

    it('marks only the weeks the window really does cut short', () => {
      // A window starting exactly on a Monday: the two weeks it covers in
      // full are not partial. The third bar is the week the run itself
      // lands in, which is (just barely) partial by definition.
      const series = fillWeeklySeries(
        [],
        new Date('2026-07-06T00:00:00.000Z'),
        new Date('2026-07-20T00:00:00.000Z'),
      );

      expect(series.map((week) => week.partial)).toEqual([false, false, true]);
    });
  });

  // Decision 3's floor, as amended by the security-reviewer pass of
  // 2026-08-02: "a bucket falling below the floor in a given run is folded
  // into the app-wide number for that metric, not fabricated and not shown
  // as a visible gap."
  describe('applyMinimumPopulationFloor', () => {
    const bucket = (
      name: '1-2' | '3-5' | '6+',
      teamCount: number,
    ): TeamSizeBucketFigures<string> => ({
      bucket: name,
      teamCount,
      figures: name,
    });

    it('reports every bucket when they all meet the floor', () => {
      const reported = applyMinimumPopulationFloor(
        [bucket('6+', 9), bucket('1-2', 5), bucket('3-5', 7)],
        5,
      );

      expect(reported.map((entry) => entry.bucket)).toEqual([
        '1-2',
        '3-5',
        '6+',
      ]);
      // Exactly at the floor is reportable — the floor is a minimum, not a
      // strictly-greater-than threshold.
      expect(reported[0].teamCount).toBe(5);
    });

    it('drops a below-floor bucket entirely (no placeholder, no null row)', () => {
      const reported = applyMinimumPopulationFloor(
        [bucket('1-2', 1), bucket('3-5', 8), bucket('6+', 12)],
        5,
      );

      expect(reported.some((entry) => entry.bucket === '1-2')).toBe(false);
      // ...and every entry that survives is a real, floor-clearing bucket.
      expect(reported.every((entry) => entry.teamCount >= 5)).toBe(true);
    });

    it('also drops the smallest surviving bucket when the suppressed residual would otherwise be derivable by subtraction', () => {
      // '1-2' has 1 team, so it is suppressed. But the report also prints
      // the app-wide number over all 21 teams, so printing both remaining
      // buckets (8 + 12) would let a reader recover the suppressed bucket
      // exactly (21 - 20 = 1 team) — defeating the floor. Complementary
      // suppression drops '3-5' too, leaving a 9-team residual that is an
      // aggregate in its own right.
      const reported = applyMinimumPopulationFloor(
        [bucket('1-2', 1), bucket('3-5', 8), bucket('6+', 12)],
        5,
      );

      expect(reported.map((entry) => entry.bucket)).toEqual(['6+']);
    });

    it('reports nothing at all when no bucket can clear the floor', () => {
      const reported = applyMinimumPopulationFloor(
        [bucket('1-2', 2), bucket('3-5', 3), bucket('6+', 4)],
        5,
      );

      expect(reported).toEqual([]);
    });

    it('is a no-op on an empty input (no teams at all yet)', () => {
      expect(applyMinimumPopulationFloor([], 5)).toEqual([]);
    });

    it('honours a raised floor — the same buckets reportable at N=5 are fully suppressed at N=10', () => {
      const buckets = [bucket('3-5', 6), bucket('6+', 40)];

      // Nothing is suppressed at N=5, so there is no residual at all.
      expect(
        applyMinimumPopulationFloor(buckets, 5).map((entry) => entry.bucket),
      ).toEqual(['3-5', '6+']);
      // At N=10 the 6-team bucket can't be printed, and printing '6+' alone
      // next to the app-wide number would hand the reader that 6-team
      // cohort's figures by subtraction — so the breakdown goes away
      // entirely. The invariant is "anything derivable from this report
      // describes at least N teams", which is strictly stronger than
      // Decision 3's per-bucket wording and never weaker.
      expect(applyMinimumPopulationFloor(buckets, 10)).toEqual([]);
    });
  });

  describe('buildHistogram', () => {
    it('sums counts landing in the same bucket', () => {
      const bars = buildHistogram(
        [
          { value: 1, count: 2 },
          { value: 2, count: 3 },
        ],
        [
          { label: 'low', min: 0, max: 5 },
          { label: 'high', min: 6, max: null },
        ],
      );
      expect(bars).toEqual([
        { bucket: 'low', count: 5 },
        { bucket: 'high', count: 0 },
      ]);
    });
  });
});
