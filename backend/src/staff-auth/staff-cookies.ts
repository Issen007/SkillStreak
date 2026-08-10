export const STAFF_SESSION_COOKIE_NAME = 'staff_session';
export const STAFF_PENDING_AUTH_COOKIE_NAME = 'staff_auth_pending';

// ADR-0023 Decision B2 — Path broadened from ADR-0022's
// /api/v1/admin-only scope, since this cookie now also rides along to
// /api/v1/pt/* (Part A, not built by this task) and
// /api/v1/staff-auth/* — still narrower than the default Path=/.
export const STAFF_SESSION_COOKIE_PATH = '/api/v1';
// The pending-auth cookie is only ever needed on this module's own
// callback route — scoped tighter than the real session cookie.
export const STAFF_PENDING_AUTH_COOKIE_PATH = '/api/v1/staff-auth';

// Where a completed sign-in lands. Deliberately a same-origin *path*, not
// a configurable absolute URL: the console has to be same-origin with the
// API for the Strict session cookie above to reach it at all (ADR-0023
// Decision B2), so making this an env var would only ever let someone
// configure it into being broken.
export const STAFF_CONSOLE_PATH = '/console/';
