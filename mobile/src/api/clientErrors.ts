import { Platform } from 'react-native';
import { API_BASE_URL, API_PREFIX } from './config';

/**
 * Reports a crash in this app to the API's `client-errors` endpoint.
 *
 * Deliberately NOT built on `apiFetch` (src/api/client.ts). That helper
 * attaches the session token, parses the body, and throws an `ApiError`
 * on a non-2xx — every one of which is wrong here:
 *
 * - **The session.** The server has nowhere to record who reported a
 *   crash (`error_log_entry` has no player column, by ADR-0022 Decision 6)
 *   and the endpoint is unauthenticated for exactly that reason. Sending
 *   a token would hand over an identity the receiver then has to discard.
 * - **Throwing.** This is called from an error boundary and from the
 *   global handler — the two places in the app where a thrown error has
 *   nowhere left to go. A reporter that can fail loudly turns one crash
 *   into two.
 *
 * So it is a bare `fetch` that swallows everything. Losing a report is
 * always better than the reporter becoming the problem.
 */

const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION ?? 'dev';

/** Matches the server's CLIENT_ERROR_PLATFORMS. */
function platform(): string {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return Platform.OS;
  return 'web';
}

/**
 * The same ceilings the server's DTO enforces.
 *
 * Applied here as well as there so an over-long stack is trimmed rather
 * than rejected: the server answers 400 for a body over the cap, and a
 * 400 would mean losing the whole report over its least important field.
 */
const MESSAGE_MAX = 500;
const NAME_MAX = 200;
const STACK_MAX = 20_000;

function describe(error: unknown): { errorName: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      errorName: (error.name || 'Error').slice(0, NAME_MAX),
      // An Error with an empty message is legal and would fail the
      // server's @MinLength(1), costing the whole report.
      message: (error.message || 'Error with no message').slice(0, MESSAGE_MAX),
      stack: error.stack ? error.stack.slice(0, STACK_MAX) : undefined,
    };
  }
  return {
    errorName: 'NonError',
    message: String(error).slice(0, MESSAGE_MAX) || 'Non-Error throw',
  };
}

export async function reportClientError(error: unknown): Promise<void> {
  try {
    const described = describe(error);
    await fetch(`${API_BASE_URL}${API_PREFIX}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: platform(),
        appVersion: APP_VERSION,
        ...described,
      }),
    });
  } catch {
    // Offline, DNS failure, the API down — all expected, none actionable
    // from inside a crashed app. There is deliberately no retry and no
    // queue: a crash report that outlives the crash would need durable
    // storage and a flush on next launch, which is a real feature with
    // its own failure modes, not a line of code. Worth building only if
    // the reports that do arrive turn out to have obvious gaps.
  }
}
