import { ExecutionContext } from '@nestjs/common';
import { ClipTaggingWorkerUnauthorizedException } from '../common/errors/exceptions';
import { ClipTaggingWorkerGuard } from './clip-tagging-worker.guard';

/**
 * This guard is the entire boundary between the public internet and
 * derived frames of children's clips (the pull topology has no network
 * boundary left to hide behind), so its failure modes are tested
 * exhaustively rather than representatively.
 */
describe('ClipTaggingWorkerGuard', () => {
  const GOOD = 'a'.repeat(40);

  function build(configured: string | undefined) {
    return new ClipTaggingWorkerGuard({
      get: () => configured,
    } as never);
  }

  function contextWith(header?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: header === undefined ? {} : { authorization: header },
        }),
      }),
    } as never;
  }

  it('admits the configured token', () => {
    expect(build(GOOD).canActivate(contextWith(`Bearer ${GOOD}`))).toBe(true);
  });

  it('accepts the scheme case-insensitively', () => {
    expect(build(GOOD).canActivate(contextWith(`bearer ${GOOD}`))).toBe(true);
  });

  describe('refuses', () => {
    const cases: Array<[string, string | undefined, string | undefined]> = [
      ['no token configured at all', undefined, `Bearer ${GOOD}`],
      ['an empty configured token', '', `Bearer ${GOOD}`],
      ['a whitespace-only configured token', '   ', `Bearer ${GOOD}`],
      ['a configured token below the length floor', 'short', 'Bearer short'],
      ['no Authorization header', GOOD, undefined],
      ['an empty Authorization header', GOOD, ''],
      ['a bare token with no scheme', GOOD, GOOD],
      ['the wrong scheme', GOOD, `Basic ${GOOD}`],
      ['a wrong token', GOOD, `Bearer ${'b'.repeat(40)}`],
      ['a prefix of the real token', GOOD, `Bearer ${GOOD.slice(0, 39)}`],
      ['the real token plus a suffix', GOOD, `Bearer ${GOOD}x`],
      ['an empty bearer value', GOOD, 'Bearer '],
    ];

    it.each(cases)('%s', (_name, configured, header) => {
      expect(() => build(configured).canActivate(contextWith(header))).toThrow(
        ClipTaggingWorkerUnauthorizedException,
      );
    });
  });

  it('says the same thing however it failed', () => {
    // A caller must not be able to learn whether the feature is configured
    // at all, so "not switched on" and "wrong token" are indistinguishable.
    const messages = [
      [undefined, `Bearer ${GOOD}`],
      [GOOD, `Bearer ${'b'.repeat(40)}`],
      [GOOD, undefined],
    ].map(([configured, header]) => {
      try {
        build(configured).canActivate(contextWith(header));
        return 'no throw';
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
  });

  it('refuses a short token even when it is presented correctly', () => {
    // The dangerous case: correctly configured from the operator's point of
    // view, and useless. Failing closed makes it visible as a broken
    // feature instead of a working one with a guessable key.
    const guard = build('tiny');
    expect(() => guard.canActivate(contextWith('Bearer tiny'))).toThrow(
      ClipTaggingWorkerUnauthorizedException,
    );
  });
});
