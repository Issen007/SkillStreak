import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
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
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      response
        .status(exception.getStatus())
        .json({ error: { code: exception.code, message: exception.message } });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: defaultCodeForStatus(status),
          message: extractMessage(exception.getResponse()),
        },
      });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'Unexpected server error.' },
    });
  }
}
