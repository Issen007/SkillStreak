import {
  ERROR_LOG_MESSAGE_MAX_LENGTH,
  ERROR_LOG_STACK_MAX_CHARS,
} from './error-log.constants';

// V8's stack frames: a header line ("TypeError: x is not a function"),
// then one indented "    at ..." line per frame.
const STACK_FRAME_LINE = /^\s+at\s/;

/**
 * The one shape this pipeline reads off an incoming request, kept as a
 * structural type rather than importing Express's `Request`: the caller
 * (AppExceptionFilter) gets whatever `host.switchToHttp().getRequest()`
 * hands it, and this function's entire contract is that it works on
 * *anything* — including `undefined` — without throwing.
 */
export interface RouteBearingRequest {
  route?: { path?: string };
  method?: string;
}

/**
 * docs/adr/0022-admin-control-center.md Decision 6's redaction allow-list,
 * plus its 2026-08-02 security-reviewer note.
 *
 * The route TEMPLATE only (`/api/v1/consent/:token`), never
 * `request.originalUrl`/`request.path`: several live routes carry a working
 * bearer secret as a path parameter (consent approval, account-erasure and
 * contact-change confirm/cancel links), so logging the resolved path would
 * durably persist a usable token into the very table the admin console
 * displays.
 *
 * The optional chaining is the security-reviewer's explicit requirement,
 * not defensive habit: Express only populates `request.route` once a route
 * has actually MATCHED. For an unmatched request — a 404 from internet
 * background-noise scanning, which is the single most common real
 * unhandled-request case in production — `request.route` is `undefined`,
 * and a naive `request.route.path` read would throw *inside the exception
 * filter itself*. The console renders the resulting NULL as "(unmatched)".
 *
 * This app calls no `setGlobalPrefix()` (every controller carries its own
 * `api/v1/...` prefix — see main.ts), and Nest registers each route on the
 * Express router under its full path rather than mounting a sub-router per
 * controller, so `request.route.path` here already IS the complete,
 * useful template. If a global prefix is ever introduced, this is the one
 * place that would need to re-prepend it.
 */
export function routeTemplateOf(
  request: RouteBearingRequest | undefined,
): string | null {
  return request?.route?.path ?? null;
}

export function requestMethodOf(
  request: RouteBearingRequest | undefined,
): string | null {
  return request?.method ?? null;
}

/**
 * `ErrorLogEntry.message` is `varchar(500)`, so this truncation is what
 * keeps a long message from turning "record an error" into "throw a
 * database error while recording an error".
 */
export function truncateMessage(message: string): string {
  return message.length > ERROR_LOG_MESSAGE_MAX_LENGTH
    ? message.slice(0, ERROR_LOG_MESSAGE_MAX_LENGTH)
    : message;
}

/**
 * Decision 6's "truncated (e.g. first ~20 frames)": keep the header line(s)
 * plus the first `maxFrames` stack frames and drop the rest — the frames
 * near the throw are the ones with any diagnostic value, and the tail is
 * mostly node internals.
 *
 * ERROR_LOG_STACK_MAX_CHARS then bounds the result regardless of shape, for
 * stacks that have no recognisable frames at all (see that constant).
 */
export function truncateStack(
  stack: string | null,
  maxFrames: number,
): string | null {
  if (!stack) return null;

  const kept: string[] = [];
  let frames = 0;
  for (const line of stack.split('\n')) {
    if (STACK_FRAME_LINE.test(line)) {
      if (frames >= maxFrames) break;
      frames += 1;
    }
    kept.push(line);
  }

  const joined = kept.join('\n');
  return joined.length > ERROR_LOG_STACK_MAX_CHARS
    ? joined.slice(0, ERROR_LOG_STACK_MAX_CHARS)
    : joined;
}

// Nest's built-in 404 for a request that matched no route at all:
// "Cannot GET /wp-login.php" — the METHOD plus the RESOLVED path.
const UNMATCHED_ROUTE_MESSAGE = /^Cannot ([A-Z]+) \/\S*$/;

/**
 * The one place a resolved request path can still reach this table despite
 * Decision 6's allow-list, found by live-testing the pipeline: for an
 * unmatched request there is no route template to record (`route` is NULL),
 * and Nest's own default `NotFoundException` message is literally
 * "Cannot GET <the resolved URL>". A near-miss on a token-bearing route
 * (say `/api/v1/consent/<token>/x`, which matches nothing) would therefore
 * persist a live consent token in `message`, through a column the redaction
 * rules never considered.
 *
 * Applied only when `route` is null — i.e. only to the unmatched case,
 * where the path is the *entire* content of the message and dropping it
 * costs nothing an operator can act on (the console already renders these
 * rows as "(unmatched)"). Every other error's message is left exactly as
 * thrown; Decision 6 is explicit that a general regex scrubber over
 * arbitrary error text would be unreliable and give false confidence.
 */
export function redactUnmatchedRouteMessage(message: string): string {
  const match = UNMATCHED_ROUTE_MESSAGE.exec(message);
  return match ? `Cannot ${match[1]} (unmatched path redacted)` : message;
}

/**
 * What actually lands in `error_name`/`message`/`stack`. `record()` accepts
 * `unknown` because that's what a `catch` binding and an exception filter
 * both really have — a non-Error throw (a bare string, a rejected
 * non-Error value) is rare but entirely possible, and must produce a row
 * rather than a crash.
 */
export function describeError(error: unknown): {
  name: string;
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      // Nest's HttpException sets `this.name = this.constructor.name`, so
      // this is 'AppException'/'NotFoundException'/'ThrottlerException' for
      // every exception this app throws, and the real class name
      // ('TypeError', 'QueryFailedError') for everything else.
      name: error.name || error.constructor.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  return { name: 'NonError', message: stringifyNonError(error), stack: null };
}

// `String(value)` rather than JSON: a circular object would make
// JSON.stringify throw, and a thrown object's own toString is at least as
// informative as its (usually empty) JSON shape.
function stringifyNonError(error: unknown): string {
  if (typeof error === 'string') return error;
  try {
    return String(error);
  } catch {
    // A thrown object with a hostile/throwing `toString` — vanishingly
    // rare, but this function's whole contract is that it is total.
    return 'Unstringifiable non-Error value';
  }
}

/**
 * Reads one of this feature's two numeric env knobs.
 *
 * Both are declared `@IsOptional()` ALONE in config/env.validation.ts —
 * deliberately not stacked with `@IsNotEmpty()`/`@IsNumberString()` — for
 * the reason that file's own OAuth/usage-metrics blocks document and
 * config/env.validation.spec.ts pins down: a k8s Secret key created from an
 * unset GitHub Actions secret, and docker-compose's `${VAR:-}`
 * interpolation, both hand the process a defined EMPTY STRING rather than an
 * absent value, and class-validator's `@IsOptional()` only skips
 * undefined/null. Validating loosely there means the parsing has to be
 * total here: empty, non-numeric, zero, negative and fractional values all
 * fall back to the default rather than producing a nonsense cutoff (or,
 * worse, a `NaN` cutoff that would delete every row or none).
 */
export function positiveIntFromConfig(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number(raw?.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// A UUID anywhere in a string. Every id this API puts in a URL path —
// playerId, teamId, clipId — is one of these.
//
// Deliberately NOT the strict RFC pattern that pins the version nibble to
// [1-5] and the variant to [89ab]. Postgres' gen_random_uuid() emits v4
// and would pass it, but the job here is to catch anything SHAPED like an
// id, not to certify that it is a well-formed one — a redactor that
// declines to remove a malformed identifier has failed at the only thing
// it exists to do. Written strictly first, and every fixture in
// client-error-redaction.spec.ts sailed straight through it.
const UUID_ANYWHERE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// The opaque codes this app mails out — consent approval, revoke, erasure
// confirm/cancel, contact change. All of them come from
// common/crypto/human-code.util.ts: exactly 8 characters from a fixed
// 32-character alphabet that omits the visually ambiguous 0/O and 1/I.
//
// Anchored to a URL PATH SEGMENT rather than matched free-floating, and
// that narrowness is deliberate. A bare code sitting in prose is not a
// realistic client error; a code inside a request URL is the realistic
// one, because that is the only place these codes ever travel. Matching
// them anywhere would mean redacting any 8-character upper-case run — and
// `DATABASE` happens to be eight characters drawn entirely from that
// alphabet, so a scrubber that broad would quietly eat real diagnostics
// to defend against a case that does not occur.
const MAILED_CODE_IN_PATH =
  /\/[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}(?![0-9A-Za-z-])/g;

/**
 * The narrow scrubber for text this codebase did not write.
 *
 * Server errors are authored here: a known set of exception classes with
 * messages this repo controls, which is why `redactUnmatchedRouteMessage`
 * above is allowed to be as narrow as it is, and why Decision 6 rejects a
 * general regex scrubber over server error text as unreliable false
 * confidence.
 *
 * **Client errors are different in the one way that matters**: the text
 * arrives from a device, and most of it was written by React Native, by
 * Expo, or by `fetch` — none of which know this project's rules. The
 * routine shape of a network failure in RN is the request URL inline in
 * the message, and this API's URLs carry a child's `playerId` or a live
 * mailed token as a path segment. That is not a hypothetical leak; it is
 * the single most common client error there is.
 *
 * So this runs over client-supplied message and stack only, and it is
 * deliberately about IDENTIFIERS rather than about meaning: a UUID and a
 * mailed code are recognisable by shape, which is exactly the property a
 * general scrubber lacks.
 *
 * **What it does not do, stated plainly rather than papered over.** It
 * cannot catch a child's screen name if one is ever interpolated into an
 * error message, because a screen name has no distinguishing shape. The
 * control for that is a rule rather than a filter — this app's own thrown
 * messages must never interpolate user content — and it is the reason the
 * ingest endpoint caps `message` hard and accepts no free-form context
 * field alongside it. Treat this function as removing the known,
 * mechanical leak, not as making arbitrary device text safe.
 */
export function redactClientText(text: string): string {
  return text
    .replace(UUID_ANYWHERE, '(id redacted)')
    .replace(MAILED_CODE_IN_PATH, '/(code redacted)');
}
