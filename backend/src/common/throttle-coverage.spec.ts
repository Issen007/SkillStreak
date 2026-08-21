import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every unauthenticated route either carries its own rate limit or is
 * listed here as a deliberate exception.
 *
 * The global `ThrottlerModule` default catches everything, so nothing is
 * unprotected today — this is about the decision being made rather than
 * inherited. `app.module.ts` claimed for a long time that this app had
 * exactly two open routes; it has 35, and a comment describing an app with
 * almost no public surface is how a new one gets added without anyone
 * thinking about limits. Half of them are links a parent clicks from an
 * email, where the code in the URL is the only credential.
 *
 * Textual, like `mailed-urls.spec.ts`, and with the same honest limit: it
 * reads decorators, so a guard applied some other way looks like no guard.
 * It errs toward asking for an explicit `@Throttle`, which is the safe
 * direction to be wrong in.
 */

const SRC = join(__dirname, '..');

/** Open on purpose, each for a reason that is not "nobody thought about it". */
const ALLOWED_WITHOUT_THROTTLE = new Set([
  // Liveness and readiness probes. Kubernetes calls this every few seconds
  // by design, and rate-limiting it would take the pod down under exactly
  // the load it exists to report on.
  '/health',
  // Starts an OAuth redirect and ends a session. Both are staff-only in
  // practice, carry no user input worth brute-forcing, and sit behind the
  // generous global default.
  '/api/v1/staff-auth/:provider/login',
  '/api/v1/staff-auth/logout',
]);

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

interface Route {
  path: string;
  file: string;
  throttled: boolean;
}

function unauthenticatedRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    const head = source.slice(
      source.indexOf('@Controller'),
      source.indexOf('export class'),
    );
    const classGuarded = head.includes('@UseGuards');
    const prefix = /@Controller\(\s*'([^']*)'/.exec(source)?.[1] ?? '';
    const body = source.slice(source.indexOf('export class'));

    for (const [, decorators] of body.matchAll(
      /((?:\s*@[\w.]+\([^;]*?\)\s*)+)\s*(?:async\s+)?\w+\s*\(/gs,
    )) {
      if (!/@(?:Get|Post|Put|Patch|Delete)\(/.test(decorators)) continue;
      if (classGuarded || decorators.includes('@UseGuards')) continue;
      const methodPath =
        /@(?:Get|Post|Put|Patch|Delete)\(\s*'([^']*)'/.exec(decorators)?.[1] ??
        '';
      routes.push({
        path: `/${[prefix, methodPath].filter(Boolean).join('/')}`.replace(
          /\/{2,}/g,
          '/',
        ),
        file: file.replace(`${SRC}/`, ''),
        throttled:
          decorators.includes('@Throttle') ||
          decorators.includes('@SkipThrottle'),
      });
    }
  }
  return routes;
}

describe('unauthenticated routes', () => {
  const routes = unauthenticatedRoutes();

  it('are found at all, so this spec cannot pass by seeing nothing', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('each carry a rate limit, or are a listed exception', () => {
    const unprotected = routes
      .filter((route) => !route.throttled)
      .filter((route) => !ALLOWED_WITHOUT_THROTTLE.has(route.path))
      .map((route) => `${route.path} (${route.file})`);

    // Naming them rather than asserting a count: the failure should say
    // which route needs a decision, not that a number moved.
    expect(unprotected).toEqual([]);
  });
});
