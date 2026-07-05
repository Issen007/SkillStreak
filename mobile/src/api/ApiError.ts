// Client-side representation of the contract's error envelope:
//   { "error": { "code": "...", "message": "..." } }
// `code` is what UI copy should branch on (per the contract's note that
// `message` is English/dev-facing, not shown verbatim to a child).
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** True for the specific 403 the contract defines for stale consent state. */
export function isConsentRequiredError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === 'consent_required'
  );
}
