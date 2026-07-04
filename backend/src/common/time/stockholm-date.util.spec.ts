import { previousDateString, stockholmDateString } from './stockholm-date.util';

describe('stockholmDateString', () => {
  it('formats a UTC instant as its Stockholm calendar date (summer, UTC+2)', () => {
    // 2026-07-03T22:30:00Z is already 2026-07-04 00:30 in Stockholm (CEST).
    expect(stockholmDateString(new Date('2026-07-03T22:30:00Z'))).toBe(
      '2026-07-04',
    );
  });

  it('formats a UTC instant as its Stockholm calendar date (winter, UTC+1)', () => {
    // 2026-01-03T22:30:00Z is still 2026-01-03 23:30 in Stockholm (CET).
    expect(stockholmDateString(new Date('2026-01-03T22:30:00Z'))).toBe(
      '2026-01-03',
    );
  });

  it('does not roll over just before local Stockholm midnight', () => {
    // 2026-07-03T21:59:00Z is 2026-07-03 23:59 CEST — still the same day.
    expect(stockholmDateString(new Date('2026-07-03T21:59:00Z'))).toBe(
      '2026-07-03',
    );
  });
});

describe('previousDateString', () => {
  it('subtracts one calendar day within a month', () => {
    expect(previousDateString('2026-07-03')).toBe('2026-07-02');
  });

  it('handles month rollover', () => {
    expect(previousDateString('2026-07-01')).toBe('2026-06-30');
  });

  it('handles year rollover', () => {
    expect(previousDateString('2026-01-01')).toBe('2025-12-31');
  });

  it('handles crossing a DST transition date correctly as calendar days', () => {
    // Sweden's spring-forward in 2026 is 2026-03-29; this must stay pure
    // calendar-day arithmetic, unaffected by the local wall-clock jump.
    expect(previousDateString('2026-03-30')).toBe('2026-03-29');
  });
});
