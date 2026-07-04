import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for all domain-level errors that need a stable machine-readable
 * `error.code`, per docs/api/phase1-contract.md's error envelope:
 *   { "error": { "code": "...", "message": "..." } }
 * Client UI copy is driven off `code`, never `message` (message is
 * English/dev-facing, per CLAUDE.md's language notes).
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }
}
