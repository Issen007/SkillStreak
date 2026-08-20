import { fillMissingDays, groupSiteVisits } from './analytics.service';
import type { SiteVisitRow } from './analytics.service';
import { SiteLocale } from './entities/site-visit.entity';

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

/**
 * The queries bucket on the Postgres session's LOCAL date; this helper
 * used to build its labels in UTC. Between midnight and 02:00 Stockholm
 * time those disagree, so the row the SQL returned for the new day
 * matched no generated key and vanished from the chart — the current
 * day's activity absent rather than zero.
 */
describe('fillMissingDays: the day boundary matches the queries', () => {
  it('includes today when Stockholm has rolled over but UTC has not', () => {
    // 00:30 on 12 Aug in Stockholm is still 22:30 on 11 Aug UTC.
    const justAfterLocalMidnight = new Date('2026-08-11T22:30:00.000Z');

    const filled = fillMissingDays(
      [{ day: '2026-08-12', value: 7 }],
      3,
      justAfterLocalMidnight,
    );

    expect(filled[filled.length - 1]).toEqual({ day: '2026-08-12', value: 7 });
  });

  it('still returns exactly one point per day, newest last', () => {
    const filled = fillMissingDays([], 5, new Date('2026-08-11T22:30:00.000Z'));

    expect(filled).toHaveLength(5);
    expect(filled[4].day).toBe('2026-08-12');
    expect(filled[0].day).toBe('2026-08-08');
  });
});

describe('groupSiteVisits', () => {
  const today = new Date('2026-08-20T12:00:00.000Z');
  const row = (
    locale: SiteLocale,
    day: string,
    views: number,
    samples = 0,
    seconds = 0,
  ): SiteVisitRow => ({
    locale,
    day,
    views,
    dwell_samples: samples,
    dwell_seconds_total: String(seconds),
  });

  it('averages by total seconds over total samples, not by day', () => {
    // THE ARITHMETIC WORTH PINNING. A quiet day with one 10s read and a
    // busy day with a hundred 100s reads is ~99s per read. Averaging the
    // two days' averages gives 55s — half the truth, and wrong in the
    // direction that makes a launch look worse than it was.
    const summary = groupSiteVisits(
      [
        row(SiteLocale.SV, '2026-08-19', 1, 1, 10),
        row(SiteLocale.SV, '2026-08-20', 100, 100, 10_000),
      ],
      7,
      today,
    );

    expect(summary.averageDwellSeconds).toBe(99);
    expect(summary.dwellSamples).toBe(101);
  });

  it('reports no average rather than zero when nothing was measured', () => {
    // "0 s" reads as "everyone leaves instantly"; null renders as an em
    // dash, which reads as "not measured". Those are opposite conclusions
    // from the same absence of data.
    const summary = groupSiteVisits(
      [row(SiteLocale.SV, '2026-08-20', 5)],
      7,
      today,
    );

    expect(summary.totalViews).toBe(5);
    expect(summary.averageDwellSeconds).toBeNull();
    expect(summary.perLocale[0].averageDwellSeconds).toBeNull();
  });

  it('keeps a language with no reads in the split', () => {
    const summary = groupSiteVisits(
      [row(SiteLocale.SV, '2026-08-20', 3)],
      7,
      today,
    );

    expect(summary.perLocale.map((l) => l.locale)).toEqual([
      SiteLocale.SV,
      SiteLocale.EN,
    ]);
    expect(summary.perLocale[1].views).toBe(0);
  });

  it('combines both languages into one daily trend', () => {
    const summary = groupSiteVisits(
      [
        row(SiteLocale.SV, '2026-08-20', 4),
        row(SiteLocale.EN, '2026-08-20', 6),
      ],
      2,
      today,
    );

    const last = summary.viewsPerDay[summary.viewsPerDay.length - 1];
    expect(last).toEqual({ day: '2026-08-20', value: 10 });
    expect(summary.totalViews).toBe(10);
  });

  it('coerces the bigint seconds column, which arrives as a string', () => {
    // Postgres returns bigint as a string; a missing Number() turns the
    // sum into string concatenation and the average into nonsense.
    const summary = groupSiteVisits(
      [
        row(SiteLocale.EN, '2026-08-19', 1, 1, 30),
        row(SiteLocale.EN, '2026-08-20', 1, 1, 90),
      ],
      7,
      today,
    );

    expect(summary.averageDwellSeconds).toBe(60);
  });

  it('splits the per-language average independently of the total', () => {
    const summary = groupSiteVisits(
      [
        row(SiteLocale.SV, '2026-08-20', 10, 10, 100),
        row(SiteLocale.EN, '2026-08-20', 1, 1, 1000),
      ],
      7,
      today,
    );

    const [sv, en] = summary.perLocale;
    expect(sv.averageDwellSeconds).toBe(10);
    expect(en.averageDwellSeconds).toBe(1000);
    // Total is weighted by samples, so it sits near the busier language.
    expect(summary.averageDwellSeconds).toBe(100);
  });
});
