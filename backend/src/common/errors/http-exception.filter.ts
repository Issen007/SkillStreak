import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorLogService } from '../../error-log/error-log.service';
import {
  RouteBearingRequest,
  requestMethodOf,
  routeTemplateOf,
} from '../../error-log/error-log.util';
import { AppException } from './app.exception';

// Plain numeric lookup, not a switch over HttpStatus — `status` here is a
// runtime `number` (whatever HttpException.getStatus() returned), not
// statically known to be a member of the HttpStatus enum.
const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  // ThrottlerGuard (see AppModule/onboarding & teams controllers) throws a
  // plain ThrottlerException — an ordinary HttpException, not an
  // AppException — so it needs an explicit mapping here to get a stable
  // code instead of falling through to the generic 'error'.
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
};

function defaultCodeForStatus(status: number): string {
  return DEFAULT_CODE_BY_STATUS[status] ?? 'error';
}

function extractMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (
    body &&
    typeof body === 'object' &&
    'message' in body &&
    body.message !== undefined
  ) {
    const message: unknown = body.message;
    if (Array.isArray(message)) return message.join('; ');
    if (
      typeof message === 'string' ||
      typeof message === 'number' ||
      typeof message === 'boolean'
    ) {
      return String(message);
    }
    return JSON.stringify(message);
  }
  return 'Unexpected error';
}

/**
 * Normalizes every error response (domain AppExceptions, built-in Nest
 * HttpExceptions like ValidationPipe failures, and anything unexpected)
 * into the single envelope shape docs/api/phase1-contract.md specifies:
 *   { "error": { "code": "...", "message": "..." } }
 *
 * Since docs/adr/0022-admin-control-center.md Decision 6 it also records
 * every one of those three branches into `error_log_entry` — 4xx domain
 * errors included, since "which domain errors are actually happening in
 * practice" is real operational signal this app has never had. The response
 * envelope is deliberately unchanged by that addition.
 *
 * Registered via APP_FILTER in AppModule (not `app.useGlobalFilters` in
 * main.ts, where it lived before Decision 6) purely so ErrorLogService can
 * be injected — a filter constructed with `new` gets no DI.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  /**
   * `@Optional()` because this filter is still constructed by hand in the
   * e2e suite (`app.useGlobalFilters(new AppExceptionFilter())`, 14 spec
   * files) where the DI container isn't involved. Without the recorder it
   * behaves exactly as it did before Decision 6 — same envelope, same
   * status, just no durable row.
   */
  constructor(@Optional() private readonly errorLogService?: ErrorLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RouteBearingRequest>();

    if (exception instanceof AppException) {
      this.record(request, exception.getStatus(), exception);
      response
        .status(exception.getStatus())
        .json({ error: { code: exception.code, message: exception.message } });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.record(request, status, exception);
      response.status(status).json({
        error: {
          code: defaultCodeForStatus(status),
          message: extractMessage(exception.getResponse()),
        },
      });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    this.record(request, HttpStatus.INTERNAL_SERVER_ERROR, exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'Unexpected server error.' },
    });
  }

  /**
   * Fire-and-forget: never awaited, so recording can't delay or fail a
   * response. Safe because both halves are total — `routeTemplateOf`
   * handles the unmatched-route case Express leaves `request.route`
   * `undefined` for (Decision 6's 2026-08-02 security-reviewer note: the
   * single most common real 404, and a naive `request.route.path` read would
   * throw inside this very filter), and `ErrorLogService.record` is
   * documented never to reject.
   *
   * Only route template, method and status are captured — never the
   * resolved path, body, query string, or headers (Decision 6's redaction
   * allow-list; `ErrorLogRecordInput` has no field to put them in).
   */
  private record(
    request: RouteBearingRequest | undefined,
    statusCode: number,
    exception: unknown,
  ): void {
    if (!isWorthRecording(request, statusCode)) {
      return;
    }
    void this.errorLogService?.record({
      source: 'http',
      route: routeTemplateOf(request),
      method: requestMethodOf(request),
      statusCode,
      error: exception,
    });
  }
}

/**
 * Which failures earn a durable `error_log_entry` row.
 *
 * Added 2026-08-08 (code-critic): recording *every* 4xx makes inbound
 * request volume the only bound on a 90-day-retention table, and — worse —
 * means a throttled client still drives one INSERT per rejected request,
 * so the rate limiter can no longer shed the load it exists to shed. Two
 * exclusions, both about traffic that says nothing about this app's health:
 *
 * - **429s.** The rejection is the system working. It is already visible
 *   in the throttler's own counters.
 * - **404s on no matched route.** Internet background-noise scanning
 *   (`/wp-login.php`, `/.env`) is continuous on any public API and is not
 *   an application error. A 404 from a route that DID match — a real
 *   handler saying "no such team" — is still recorded, because that one
 *   can mean something is wrong.
 *
 * Every 5xx is always recorded, including a 500 on an unmatched route.
 */
function isWorthRecording(
  request: RouteBearingRequest | undefined,
  statusCode: number,
): boolean {
  if (statusCode >= 500) {
    return true;
  }
  // Numeric literals, matching DEFAULT_CODE_BY_STATUS's own reasoning
  // above: `statusCode` is whatever HttpException.getStatus() returned — a
  // runtime number, not statically an HttpStatus member — so comparing it
  // against the enum trips no-unsafe-enum-comparison.
  if (statusCode === 429) {
    return false;
  }
  if (statusCode === 404 && request?.route === undefined) {
    return false;
  }
  return true;
}
