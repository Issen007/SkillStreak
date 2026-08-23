import { reportClientError } from './clientErrors';

/**
 * Catches the crashes a React error boundary structurally cannot.
 *
 * `CrashBoundary` only ever sees errors thrown during render, in a
 * lifecycle method, or in a constructor — that is what React's boundary
 * contract covers, and it is the minority of what actually goes wrong in
 * this app. An error inside a `setTimeout`, an event handler, or an
 * unawaited promise never passes through the render path at all, so the
 * boundary is blind to exactly the asynchronous failures that a
 * network-driven app produces most of.
 *
 * ## Chaining rather than replacing
 *
 * Both handlers below call whatever was registered before them. In a dev
 * build that previous handler is React Native's own — the red box, and
 * the LogBox rejection warning. Replacing it would mean this file made
 * crashes *harder* to see while developing, in exchange for seeing them
 * in production, which is a bad trade and an easy one to make by
 * accident.
 *
 * ## Why `isFatal` is not used to filter
 *
 * RN's handler reports both fatal and non-fatal errors. It is tempting to
 * send only fatals, on the grounds that the app survived the others — but
 * a non-fatal error is very often a feature that silently did nothing,
 * which is precisely the failure a user never reports and nobody ever
 * finds. Both are sent; the server's throttle is what bounds the volume.
 */

interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

/**
 * Guarded because `ErrorUtils` is a React Native runtime global with no
 * type declaration and no presence at all under a plain Node test
 * environment — this module is imported by app startup, which the test
 * suite exercises.
 */
function errorUtils(): ErrorUtilsLike | undefined {
  return (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
}

let installed = false;

export function installGlobalErrorHandler(): void {
  // Idempotent: a Fast Refresh in development re-runs module side effects,
  // and chaining onto our own previous handler would send each error twice,
  // then four times, then eight.
  if (installed) return;
  installed = true;

  const utils = errorUtils();
  if (utils?.setGlobalHandler) {
    const previous = utils.getGlobalHandler?.();
    utils.setGlobalHandler((error, isFatal) => {
      void reportClientError(error);
      previous?.(error, isFatal);
    });
  }

  // Unhandled promise rejections. Hermes and the Expo web export both
  // dispatch `unhandledrejection` on the global; RN's own tracking hooks
  // are private API and have moved more than once between versions, so
  // the standard event is the stable surface to use.
  const target = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  if (typeof target.addEventListener === 'function') {
    target.addEventListener('unhandledrejection', (event: unknown) => {
      const reason = (event as { reason?: unknown } | undefined)?.reason;
      void reportClientError(reason ?? new Error('Unhandled promise rejection'));
    });
  }
}
