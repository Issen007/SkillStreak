import { Jurisdiction } from './article8-age';
import { isSelfVerificationAge } from './self-verification-age.util';

/**
 * These were written when 13 was the answer everywhere, and they passed
 * for as long as that was wrong — a 14-year-old in Munich cleared them
 * just as happily as one in Malmö. Every case now names the jurisdiction
 * it is asserting about, which is the point: there is no such thing as
 * "the self-verification age" without one.
 */
describe('isSelfVerificationAge', () => {
  const thisYear = new Date().getUTCFullYear();
  const born = (age: number) => thisYear - age;

  describe('in Sweden, where the age is 13', () => {
    it('is false for a player who is exactly 12', () => {
      expect(isSelfVerificationAge(born(12), Jurisdiction.SE)).toBe(false);
    });

    it('is true for a player who is exactly 13', () => {
      expect(isSelfVerificationAge(born(13), Jurisdiction.SE)).toBe(true);
    });

    it('is true well above 13', () => {
      expect(isSelfVerificationAge(born(40), Jurisdiction.SE)).toBe(true);
    });
  });

  describe('in Germany, where the same ages give the opposite answer', () => {
    it('is false at 13, which Sweden allows', () => {
      expect(isSelfVerificationAge(born(13), Jurisdiction.DE)).toBe(false);
    });

    it('is false at 15, one year short', () => {
      expect(isSelfVerificationAge(born(15), Jurisdiction.DE)).toBe(false);
    });

    it('is true at 16', () => {
      expect(isSelfVerificationAge(born(16), Jurisdiction.DE)).toBe(true);
    });
  });

  it('asks for a parent when the jurisdiction is unknown', () => {
    // Not a lesser answer than Sweden's — a stricter one. A team whose
    // country nobody has stated must not inherit the country this app
    // happened to be written in.
    expect(isSelfVerificationAge(born(13), null)).toBe(false);
    expect(isSelfVerificationAge(born(16), null)).toBe(true);
  });
});
