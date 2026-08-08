import {
  ArgumentsHost,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AppException } from './app.exception';
import { AppExceptionFilter } from './http-exception.filter';

function buildHost(request: unknown): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, json }),
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function buildFilter(
  request: unknown = { route: { path: '/api/v1/x' }, method: 'GET' },
) {
  const errorLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const filter = new AppExceptionFilter(errorLogService as never);
  return { filter, errorLogService, ...buildHost(request) };
}

// The response envelope (docs/api/phase1-contract.md) is unchanged by
// docs/adr/0022-admin-control-center.md Decision 6's recording — these
// assertions exist so that stays true.
describe('AppExceptionFilter response envelope', () => {
  it('maps an AppException to its own code and message', () => {
    const { filter, host, status, json } = buildFilter();

    filter.catch(
      new AppException(
        'consent_required',
        'Parental consent required.',
        HttpStatus.FORBIDDEN,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'consent_required',
        message: 'Parental consent required.',
      },
    });
  });

  it('maps a generic HttpException to the status default code', () => {
    const { filter, host, status, json } = buildFilter();

    filter.catch(new BadRequestException('bad body'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'validation_error', message: 'bad body' },
    });
  });

  it('maps anything unexpected to a generic 500', () => {
    const { filter, host, status, json } = buildFilter();

    filter.catch(new TypeError('x is not a function'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'internal_error', message: 'Unexpected server error.' },
    });
  });

  // The filter is still constructed by hand in the e2e suite, where no DI
  // container is involved — it must behave exactly as it did before
  // Decision 6 when no recorder is present.
  it('still responds normally with no ErrorLogService injected', () => {
    const { host, status, json } = buildHost({ route: { path: '/x' } });
    const filter = new AppExceptionFilter();

    filter.catch(new NotFoundException('nope'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'not_found', message: 'nope' },
    });
  });
});

// docs/adr/0022-admin-control-center.md Decision 6 — "a call to a new
// ErrorLogService.record(...) for every branch (not just the current
// catch-all)".
describe('AppExceptionFilter error recording', () => {
  it('records a 4xx AppException, not just the 500 catch-all', () => {
    const { filter, host, errorLogService } = buildFilter({
      route: { path: '/api/v1/consent/:token' },
      method: 'GET',
    });
    const exception = new AppException(
      'not_found',
      'Consent token not found or already used',
      HttpStatus.NOT_FOUND,
    );

    filter.catch(exception, host);

    expect(errorLogService.record).toHaveBeenCalledWith({
      source: 'http',
      route: '/api/v1/consent/:token',
      method: 'GET',
      statusCode: 404,
      error: exception,
    });
  });

  it('records a generic HttpException branch', () => {
    const { filter, host, errorLogService } = buildFilter({
      route: { path: '/api/v1/players' },
      method: 'POST',
    });

    filter.catch(new BadRequestException('bad body'), host);

    expect(errorLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'http', statusCode: 400 }),
    );
  });

  it('records the unknown/500 catch-all branch', () => {
    const { filter, host, errorLogService } = buildFilter({
      route: { path: '/api/v1/teams/:teamId/clips' },
      method: 'POST',
    });

    filter.catch(new TypeError('x is not a function'), host);

    expect(errorLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'http',
        route: '/api/v1/teams/:teamId/clips',
        statusCode: 500,
      }),
    );
  });

  /**
   * Decision 6's 2026-08-02 security-reviewer note, verbatim: Express only
   * populates `request.route` once a route has actually MATCHED, so for an
   * ordinary unmatched 404 — internet background-noise scanning, the single
   * most common real case in production — it is `undefined`, and a naive
   * `request.route.path` read would throw INSIDE the filter itself.
   */
  it('does not throw for an unmatched route (request.route === undefined)', () => {
    const { filter, host, errorLogService, status, json } = buildFilter({
      method: 'GET',
      // No `route` at all — exactly what Express hands the filter here.
      originalUrl: '/wp-login.php',
    });

    expect(() =>
      filter.catch(new NotFoundException('Cannot GET /wp-login.php'), host),
    ).not.toThrow();

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalled();
    expect(errorLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ route: null, method: 'GET', statusCode: 404 }),
    );
  });

  // The redaction allow-list is enforced by ErrorLogRecordInput having no
  // field for any of this — asserted here so a future "just attach the
  // request" convenience change fails a test rather than a review.
  it('never passes the resolved path, body, query or headers to the recorder', () => {
    const { filter, host, errorLogService } = buildFilter({
      route: { path: '/api/v1/consent/:token' },
      method: 'POST',
      originalUrl: '/api/v1/consent/live-secret-token',
      path: '/api/v1/consent/live-secret-token',
      body: { parentContact: 'parent@example.com' },
      query: { token: 'live-secret-token' },
      headers: { authorization: 'Bearer live-session-token' },
    });

    filter.catch(new NotFoundException('nope'), host);

    const [[recorded]] = errorLogService.record.mock.calls as [
      [Record<string, unknown>],
    ];
    expect(Object.keys(recorded).sort()).toEqual([
      'error',
      'method',
      'route',
      'source',
      'statusCode',
    ]);
    expect(JSON.stringify(recorded)).not.toContain('live-secret-token');
  });

  // Fire-and-forget: a recorder that somehow rejects must not surface as a
  // thrown exception out of the filter.
  it('does not await the recorder', () => {
    const { host } = buildHost({ route: { path: '/x' }, method: 'GET' });
    const errorLogService = {
      record: jest.fn().mockReturnValue(Promise.resolve()),
    };
    const filter = new AppExceptionFilter(errorLogService as never);

    expect(() =>
      filter.catch(new NotFoundException('nope'), host),
    ).not.toThrow();
  });
});
