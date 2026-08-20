import { BeaconTokenService } from './beacon-token.service';

/**
 * The beacon token.
 *
 * Two properties matter and are easy to lose: it must not verify anything
 * it did not sign, and it must not be an identifier. The second is tested
 * as explicitly as the first, because it is the one a future "improvement"
 * would break — attaching a visitor id here would make the counters
 * personal data and require a consent banner.
 */
function build(secret = 'test-secret-value') {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(secret),
  };
  return new BeaconTokenService(configService as never);
}

const T = Date.UTC(2026, 7, 20, 12, 0, 0);
const FIVE_MIN = 5 * 60 * 1000;

describe('BeaconTokenService', () => {
  it('verifies a token it just issued', () => {
    const service = build();
    expect(service.verify(service.issue(T), T)).toBe(true);
  });

  it('identifies nobody — two readers in the same window get the same token', () => {
    // Load-bearing. A per-visitor token would be exactly the tracking
    // identifier this site refuses to set, and would drag an ePrivacy
    // consent banner onto a site children reach. Nothing about the
    // request may ever be mixed in here.
    const service = build();
    expect(service.issue(T)).toBe(service.issue(T + 1000));
  });

  it('still verifies one bucket later, so a boundary does not drop a read', () => {
    const service = build();
    const token = service.issue(T);
    expect(service.verify(token, T + FIVE_MIN)).toBe(true);
  });

  it('rejects a token older than the grace window', () => {
    const service = build();
    const token = service.issue(T);
    expect(service.verify(token, T + 3 * FIVE_MIN)).toBe(false);
  });

  it('rejects a token minted for a future bucket', () => {
    // Otherwise a scraped token could be pre-dated to last indefinitely.
    const service = build();
    const future = service.issue(T + 10 * FIVE_MIN);
    expect(service.verify(future, T)).toBe(false);
  });

  it('rejects a signature from a different secret', () => {
    const mine = build('secret-a');
    const theirs = build('secret-b');
    expect(mine.verify(theirs.issue(T), T)).toBe(false);
  });

  it('rejects a tampered bucket that keeps the original signature', () => {
    const service = build();
    const token = service.issue(T);
    const forged =
      String(Number(token.split('.')[0]) - 1) + '.' + token.split('.')[1];
    expect(service.verify(forged, T)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 12345],
    ['an object', { token: 'x' }],
    ['an empty string', ''],
    ['no separator', 'abcdef'],
    ['a leading separator', '.abcdef'],
    ['a non-numeric bucket', 'abc.def'],
    ['an absurdly long string', 'a'.repeat(5000)],
  ])('rejects %s without throwing', (_label, value) => {
    const service = build();
    expect(() => service.verify(value, T)).not.toThrow();
    expect(service.verify(value, T)).toBe(false);
  });

  it('derives a key distinct from the raw JWT secret', () => {
    // The label in the HMAC is what stops this token and a session token
    // ever being interchangeable if one leaked into the other's verifier.
    const service = build('shared');
    expect(service.issue(T)).not.toContain('shared');
  });
});
