import { isSelfVerificationAge } from './self-verification-age.util';

describe('isSelfVerificationAge', () => {
  const thisYear = new Date().getUTCFullYear();

  it('is false for a birth year that makes the player exactly 12', () => {
    expect(isSelfVerificationAge(thisYear - 12)).toBe(false);
  });

  it('is true for a birth year that makes the player exactly 13', () => {
    expect(isSelfVerificationAge(thisYear - 13)).toBe(true);
  });

  it('is true for a birth year well above 13', () => {
    expect(isSelfVerificationAge(thisYear - 40)).toBe(true);
  });
});
