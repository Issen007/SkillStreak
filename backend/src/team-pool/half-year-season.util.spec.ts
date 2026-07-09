import { computeHalfYearSeason } from './half-year-season.util';

describe('computeHalfYearSeason', () => {
  it('maps January through June to "Vår <year>", Jan 1 - Jun 30', () => {
    expect(computeHalfYearSeason('2026-01-01')).toEqual({
      label: 'Vår 2026',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
    expect(computeHalfYearSeason('2026-06-30')).toEqual({
      label: 'Vår 2026',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
  });

  it('maps July through December to "Höst <year>", Jul 1 - Dec 31', () => {
    expect(computeHalfYearSeason('2026-07-01')).toEqual({
      label: 'Höst 2026',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
    });
    expect(computeHalfYearSeason('2026-12-31')).toEqual({
      label: 'Höst 2026',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
    });
  });

  it("uses the creation date's own year, not a fixed one", () => {
    expect(computeHalfYearSeason('2027-03-15')).toEqual({
      label: 'Vår 2027',
      startDate: '2027-01-01',
      endDate: '2027-06-30',
    });
  });

  it('the boundary month (June 30 vs July 1) falls on the correct side', () => {
    expect(computeHalfYearSeason('2026-06-15').label).toBe('Vår 2026');
    expect(computeHalfYearSeason('2026-07-15').label).toBe('Höst 2026');
  });
});
