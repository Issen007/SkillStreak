import { computeSeason } from './season.util';

// A season is a full calendar year (project owner, 2026-08-10), replacing
// the original half-year "Vår"/"Höst" grid. The property that actually
// matters for ADR-0008's cross-team leaderboard is that every date in a
// year maps to the SAME season — otherwise two teams' pots would cover
// different spans and their totals would not be comparable.
describe('computeSeason', () => {
  it('maps every month of a year to one identical season', () => {
    const seasons = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0');
      return computeSeason(`2026-${month}-15`);
    });

    for (const season of seasons) {
      expect(season).toEqual(seasons[0]);
    }
  });

  it('runs Jan 1 to Dec 31 and is labelled by the year', () => {
    expect(computeSeason('2026-08-10')).toEqual({
      label: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
  });

  // The reset moment. Dec 31 and Jan 1 must land in different seasons, or
  // points would carry across the year boundary the owner wants them
  // cleared at.
  it('puts the last day of a year and the first day of the next in different seasons', () => {
    const decemberSeason = computeSeason('2026-12-31');
    const januarySeason = computeSeason('2027-01-01');

    expect(decemberSeason.label).toBe('2026');
    expect(januarySeason.label).toBe('2027');
    expect(januarySeason.startDate).toBe('2027-01-01');
  });

  it('handles both boundary days of the same year', () => {
    expect(computeSeason('2026-01-01').label).toBe('2026');
    expect(computeSeason('2026-12-31').label).toBe('2026');
  });
});
