import { redactClientText } from './error-log.util';

/**
 * The redaction that exists because client error text is not written by
 * this codebase.
 *
 * Every case below is a real shape rather than an invented one: React
 * Native puts the request URL into a `fetch` failure message verbatim,
 * and this API's URLs carry a child's id or a live mailed code as a path
 * segment. That is not a corner case — it is the most common client error
 * there is.
 */
describe('redactClientText', () => {
  it('removes a player id from the fetch failure message RN actually produces', () => {
    const real =
      'Network request failed: GET https://api.skillstreak.xyz/api/v1/players/6f9619ff-8b86-d011-b42d-00cf4fc964ff/streak';

    const redacted = redactClientText(real);

    expect(redacted).not.toContain('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    expect(redacted).toContain('(id redacted)');
    // The rest survives — the point is to keep the report actionable.
    expect(redacted).toContain('/api/v1/players/');
    expect(redacted).toContain('/streak');
  });

  it('removes every id when a message carries more than one', () => {
    const two = redactClientText(
      'clip 6f9619ff-8b86-d011-b42d-00cf4fc964ff on team 3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );

    expect(two).toBe('clip (id redacted) on team (id redacted)');
  });

  it('removes a live mailed code from a URL path', () => {
    // The exact shape generateHumanCode produces: 8 characters from
    // '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'. A real one leaked into a 404
    // message on 2026-08-21, which is how this whole area got looked at.
    const real =
      'Cannot GET https://api.skillstreak.xyz/api/v1/public-sharing/GSK2777S';

    expect(redactClientText(real)).not.toContain('GSK2777S');
    expect(redactClientText(real)).toContain('(code redacted)');
  });

  it('leaves ordinary diagnostic text alone', () => {
    // The reason the code pattern is anchored to a path segment rather
    // than matched anywhere: DATABASE is eight characters drawn entirely
    // from the code alphabet, and a scrubber broad enough to catch a bare
    // code would eat it.
    const ordinary =
      'TypeError: undefined is not a function (DATABASE unreachable)';

    expect(redactClientText(ordinary)).toBe(ordinary);
  });

  it('does not mistake a longer path segment for a code', () => {
    const notACode = 'GET /api/v1/teams/ABCDEFGHIJKL/roster';

    expect(redactClientText(notACode)).toBe(notACode);
  });

  it('scrubs a stack trace, not just a message', () => {
    const stack = [
      'Error: request failed',
      '    at fetchClip (https://api.skillstreak.xyz/api/v1/clips/6f9619ff-8b86-d011-b42d-00cf4fc964ff:1:1)',
      '    at renderClip (ClipCard.tsx:42:9)',
    ].join('\n');

    const redacted = redactClientText(stack);

    expect(redacted).not.toContain('6f9619ff');
    expect(redacted).toContain('at renderClip (ClipCard.tsx:42:9)');
  });

  /**
   * Found by the 2026-08-26 security review, not by writing this file.
   *
   * The path-anchored pattern above missed the shape that matters most:
   * the team invite link the app builds and shares is
   * `<site>/?code=ABCD2345`. And a team invite code is worse than the
   * mailed codes this scrubber was written for — `Team.invite_code` has
   * no expiry and no single-use semantics, so it is a durable credential
   * for joining a team.
   */
  it('removes a team invite code from a query string, not just a path', () => {
    const real =
      'Network request failed: GET https://skillstreak.xyz/?code=GSK2777S';

    const redacted = redactClientText(real);

    expect(redacted).not.toContain('GSK2777S');
    expect(redacted).toContain('?code=(code redacted)');
  });

  it('removes a token query parameter too', () => {
    expect(
      redactClientText('https://skillstreak.xyz/x?foo=1&token=ABCD2345'),
    ).toBe('https://skillstreak.xyz/x?foo=1&token=(code redacted)');
  });

  it('leaves an ordinary query value alone', () => {
    const ordinary = 'GET /api/v1/teams?limit=20&sort=name';
    expect(redactClientText(ordinary)).toBe(ordinary);
  });
});
