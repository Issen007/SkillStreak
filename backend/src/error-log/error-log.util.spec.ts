import { ERROR_LOG_STACK_MAX_CHARS } from './error-log.constants';
import {
  describeError,
  positiveIntFromConfig,
  redactUnmatchedRouteMessage,
  requestMethodOf,
  routeTemplateOf,
  truncateMessage,
  truncateStack,
} from './error-log.util';

// docs/adr/0022-admin-control-center.md Decision 6's redaction allow-list
// and its 2026-08-02 security-reviewer note.
describe('routeTemplateOf', () => {
  it('returns the registered route template', () => {
    expect(routeTemplateOf({ route: { path: '/api/v1/consent/:token' } })).toBe(
      '/api/v1/consent/:token',
    );
  });

  // Express only populates `request.route` once a route has MATCHED — the
  // unmatched-404 case is both the most common one in production and the
  // one a naive `request.route.path` read would throw on.
  it('returns null for an unmatched request, rather than throwing', () => {
    expect(() => routeTemplateOf({ method: 'GET' })).not.toThrow();
    expect(routeTemplateOf({ method: 'GET' })).toBeNull();
    expect(routeTemplateOf(undefined)).toBeNull();
  });

  it('reads the method independently of the route', () => {
    expect(requestMethodOf({ method: 'POST' })).toBe('POST');
    expect(requestMethodOf(undefined)).toBeNull();
  });
});

describe('truncateMessage', () => {
  it('leaves a short message alone', () => {
    expect(truncateMessage('boom')).toBe('boom');
  });

  it('cuts at the varchar(500) column width', () => {
    expect(truncateMessage('x'.repeat(501))).toHaveLength(500);
  });
});

describe('truncateStack', () => {
  const stack = [
    'TypeError: x is not a function',
    '    at a (a.ts:1:1)',
    '    at b (b.ts:2:2)',
    '    at c (c.ts:3:3)',
  ].join('\n');

  it('keeps the header and the first N frames', () => {
    expect(truncateStack(stack, 2)).toBe(
      [
        'TypeError: x is not a function',
        '    at a (a.ts:1:1)',
        '    at b (b.ts:2:2)',
      ].join('\n'),
    );
  });

  it('leaves a stack shorter than the limit untouched', () => {
    expect(truncateStack(stack, 20)).toBe(stack);
  });

  it('returns null when there is no stack (a non-Error throw)', () => {
    expect(truncateStack(null, 20)).toBeNull();
  });

  // The backstop for stacks that don't have V8's `    at ...` shape at all,
  // which the frame limit can't bound.
  it('caps a frameless stack by character count', () => {
    const frameless = 'y'.repeat(ERROR_LOG_STACK_MAX_CHARS + 500);

    expect(truncateStack(frameless, 20)).toHaveLength(
      ERROR_LOG_STACK_MAX_CHARS,
    );
  });
});

// The one path by which a resolved request path could still reach this
// table: Nest's own default 404 message for an unmatched request.
describe('redactUnmatchedRouteMessage', () => {
  it('drops the resolved path from an unmatched-route 404 message', () => {
    expect(
      redactUnmatchedRouteMessage(
        'Cannot GET /api/v1/consent/live-secret-token/x',
      ),
    ).toBe('Cannot GET (unmatched path redacted)');
  });

  it('leaves every other message exactly as thrown', () => {
    for (const message of [
      'Consent token not found or already used',
      'Cannot read properties of undefined',
      'Cannot GET something without a leading slash',
    ]) {
      expect(redactUnmatchedRouteMessage(message)).toBe(message);
    }
  });
});

describe('describeError', () => {
  it('uses the exception class name for a real Error', () => {
    expect(describeError(new TypeError('nope'))).toMatchObject({
      name: 'TypeError',
      message: 'nope',
    });
  });

  it('handles a non-Error throw', () => {
    expect(describeError('bare string')).toEqual({
      name: 'NonError',
      message: 'bare string',
      stack: null,
    });
    expect(describeError({ a: 1 }).name).toBe('NonError');
  });
});

// The empty-string-env-var trap this repo has hit before (see
// config/env.validation.ts's own comments): '' is a PRESENT value, so
// @IsOptional() doesn't skip it and parsing must be total.
describe('positiveIntFromConfig', () => {
  it('parses a valid positive integer', () => {
    expect(positiveIntFromConfig('30', 90)).toBe(30);
    expect(positiveIntFromConfig(' 30 ', 90)).toBe(30);
  });

  it('falls back for undefined, empty, non-numeric, zero, negative and fractional values', () => {
    for (const bad of [
      undefined,
      '',
      '  ',
      'ninety',
      '0',
      '-5',
      '2.5',
      'NaN',
    ]) {
      expect(positiveIntFromConfig(bad, 90)).toBe(90);
    }
  });
});
