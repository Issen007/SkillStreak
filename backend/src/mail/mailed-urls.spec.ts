import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every URL this codebase mails out must resolve to a route it mounts.
 *
 * On 2026-08-21 two did not. `PublicSharingConsentService` built its
 * approval and revoke links from the service *file*'s name —
 * `/api/v1/public-sharing-consent/...` — where the controller mounts
 * `/api/v1/public-sharing/...`, so the first parental consent mail ever
 * delivered in production handed a parent a 404 and neither end of
 * ADR-0030's flow had ever been reachable. `public-sharing-url.spec.ts`
 * now covers that one pair properly, against Nest's own route metadata.
 *
 * This is the sweep that would have found it without knowing where to
 * look. It reads the source rather than the running app, which makes it
 * cheap enough to cover every flow at once: parental consent, PT consent
 * and its revoke, account erasure's confirm and cancel, the demo list's
 * unsubscribe and release opt-in, and public sharing.
 *
 * A textual check has a real limit and it is worth stating: it sees only
 * URLs written as template literals against a configured base. A path
 * assembled some other way is invisible to it. It is a net under the
 * common shape, not a proof.
 */

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** `/api/v1/thing/${code}` and `/api/v1/thing/:code` both become the same. */
function normalise(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/:[A-Za-z][A-Za-z0-9_]*/g, ':param')
    .replace(/\/+$/, '');
}

/** Route templates the app actually mounts, from the decorators. */
function mountedRoutes(files: string[]): Set<string> {
  const routes = new Set<string>();
  for (const file of files.filter((f) => f.endsWith('.controller.ts'))) {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\(\s*'([^']*)'/.exec(source)?.[1] ?? '';
    const methods = source.matchAll(
      /@(?:Get|Post|Put|Patch|Delete)\(\s*'([^']*)'/g,
    );
    for (const [, methodPath] of methods) {
      const joined = [prefix, methodPath]
        .filter(Boolean)
        .join('/')
        .replace(/\/{2,}/g, '/');
      routes.add(normalise(`/${joined.replace(/^\//, '')}`));
    }
  }
  return routes;
}

/** URLs built for a person to click, as `${base}/api/v1/...`. */
function builtUrls(files: string[]): { file: string; path: string }[] {
  const found: { file: string; path: string }[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // A template literal whose first interpolation is followed by a path.
    for (const [, path] of source.matchAll(
      /`\$\{[^}]*\}(\/api\/v1\/[^`]*)`/g,
    )) {
      found.push({ file: file.replace(`${SRC}/`, ''), path });
    }
  }
  return found;
}

describe('every mailed URL resolves to a mounted route', () => {
  const files = sourceFiles(SRC);
  const routes = mountedRoutes(files);
  const urls = builtUrls(files);

  it('finds both routes and built URLs to compare', () => {
    // Guards against the check silently passing because a refactor moved
    // URLs out of template literals and this spec found nothing at all.
    expect(routes.size).toBeGreaterThan(20);
    expect(urls.length).toBeGreaterThan(4);
  });

  it.each(builtUrls(sourceFiles(SRC)))(
    'mounts $path (built in $file)',
    ({ path }) => {
      expect([...routes]).toContain(normalise(path));
    },
  );
});
