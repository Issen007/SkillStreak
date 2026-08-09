import { resolveAdminEnvironment } from './admin-environment.util';

// docs/design/phase7-admin-console-flows.md §2's environment badge. The
// values under test are the two real ones: production's own
// k8s/configmap.yaml APP_PUBLIC_URL, and the ubuntu01 internal cluster's
// LAN address (CLAUDE.md's environment-parity section).
describe('resolveAdminEnvironment', () => {
  it('reports production for the real public API hostname', () => {
    expect(resolveAdminEnvironment('https://api.skillstreak.xyz')).toBe(
      'production',
    );
  });

  it('reports internal_test for the ubuntu01 LAN address', () => {
    expect(resolveAdminEnvironment('http://192.168.55.71:3000')).toBe(
      'internal_test',
    );
  });

  // The failure direction is chosen: an internal console mislabelled
  // PRODUCTION would make the operator trust the wrong cluster, which is the
  // exact 2026-07-30 class of mistake this badge exists to catch.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['malformed', 'not a url'],
    ['plain http on a real domain', 'http://api.skillstreak.xyz'],
    ['localhost', 'http://localhost:3000'],
    ['https on an IP literal', 'https://192.168.55.71'],
    ['an mDNS name', 'https://ubuntu01.local'],
  ])('falls back to internal_test when APP_PUBLIC_URL is %s', (_label, url) => {
    expect(resolveAdminEnvironment(url)).toBe('internal_test');
  });

  it('tolerates surrounding whitespace from a ConfigMap value', () => {
    expect(resolveAdminEnvironment('  https://api.skillstreak.xyz  ')).toBe(
      'production',
    );
  });
});
