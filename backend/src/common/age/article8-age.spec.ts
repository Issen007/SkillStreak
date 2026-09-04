import {
  article8AgeFor,
  Jurisdiction,
  STRICTEST_ARTICLE_8_AGE,
} from './article8-age';
import { isSelfVerificationAge } from './self-verification-age.util';

/**
 * The property that matters here is not "the table has the right numbers"
 * — those are a legal parameter that can change by national amendment.
 * It is that an unknown jurisdiction can never be more permissive than a
 * known one, so a gap in the table costs a family an extra consent email
 * rather than costing a child the protection the law gives them.
 */
describe('GDPR Article 8 age by jurisdiction', () => {
  it('gives Sweden 13, the age this app used to apply to everyone', () => {
    expect(article8AgeFor(Jurisdiction.SE)).toBe(13);
  });

  it('gives Germany 16 and Austria 14, which share the `de` locale', () => {
    // The whole reason locale cannot answer this question: one language,
    // two different legal ages, and a third country outside the GDPR.
    expect(article8AgeFor(Jurisdiction.DE)).toBe(16);
    expect(article8AgeFor(Jurisdiction.AT)).toBe(14);
    expect(article8AgeFor(Jurisdiction.CH)).toBe(STRICTEST_ARTICLE_8_AGE);
  });

  it('gives France 15 and Belgium 13, which share the `fr` locale', () => {
    expect(article8AgeFor(Jurisdiction.FR)).toBe(15);
    expect(article8AgeFor(Jurisdiction.BE)).toBe(13);
  });

  it('never returns an age below 13 or above 16', () => {
    // Article 8(1) sets 16 and permits lowering to no less than 13. A row
    // outside that range is a typo, and a typo here is a consent bug.
    for (const j of Object.values(Jurisdiction)) {
      const age = article8AgeFor(j);
      expect(age).toBeGreaterThanOrEqual(13);
      expect(age).toBeLessThanOrEqual(16);
    }
  });

  it('falls back to the STRICTEST age when the jurisdiction is unknown', () => {
    expect(article8AgeFor(null)).toBe(STRICTEST_ARTICLE_8_AGE);
    expect(article8AgeFor(undefined)).toBe(STRICTEST_ARTICLE_8_AGE);
    expect(STRICTEST_ARTICLE_8_AGE).toBe(16);
  });

  it('is never more permissive when unknown than when known', () => {
    // The load-bearing property. If this ever fails, a missing
    // jurisdiction has become a way to get a LOWER bar than a real
    // country, which is the opposite of failing safe.
    const unknown = article8AgeFor(null);
    for (const j of Object.values(Jurisdiction)) {
      expect(article8AgeFor(j)).toBeLessThanOrEqual(unknown);
    }
  });
});

describe('isSelfVerificationAge, per jurisdiction', () => {
  const born = (age: number) => new Date().getUTCFullYear() - age;

  it('lets a 14-year-old self-consent in Sweden but not in Germany', () => {
    expect(isSelfVerificationAge(born(14), Jurisdiction.SE)).toBe(true);
    expect(isSelfVerificationAge(born(14), Jurisdiction.DE)).toBe(false);
  });

  it('lets a 14-year-old self-consent in Austria but not a 13-year-old', () => {
    expect(isSelfVerificationAge(born(14), Jurisdiction.AT)).toBe(true);
    expect(isSelfVerificationAge(born(13), Jurisdiction.AT)).toBe(false);
  });

  it('asks a parent for a 15-year-old whose jurisdiction is unknown', () => {
    // The behaviour a brand-new team gets before anyone states a country.
    expect(isSelfVerificationAge(born(15), null)).toBe(false);
    expect(isSelfVerificationAge(born(16), null)).toBe(true);
  });

  it('still asks a parent for a 9-year-old anywhere', () => {
    for (const j of Object.values(Jurisdiction)) {
      expect(isSelfVerificationAge(born(9), j)).toBe(false);
    }
    expect(isSelfVerificationAge(born(9), null)).toBe(false);
  });
});
