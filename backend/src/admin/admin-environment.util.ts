/**
 * docs/design/phase7-admin-console-flows.md §2's environment badge —
 * `PRODUCTION` or `INTERNAL TEST` in the console header.
 *
 * **Why this is derived rather than configured.** §13 asks for a value to
 * render; CLAUDE.md's environment-parity section says not to invent a second
 * environment-detection mechanism alongside the existing per-cluster
 * `ConfigMap` convention. `APP_PUBLIC_URL` is already exactly that: it's set
 * per cluster (production's `k8s/configmap.yaml` holds
 * `https://api.skillstreak.xyz`; the `ubuntu01` internal cluster's own
 * ConfigMap holds its `192.168.55.x` LAN address), it already differs
 * between the two environments for a real functional reason, and it is the
 * one existing value that actually *names* which deployment this process is.
 *
 * `NODE_ENV` deliberately isn't used: it is `"production"` on **both**
 * clusters (both run the production build), so it cannot tell them apart —
 * exactly the kind of assumption the 2026-07-30 wrong-image incident this
 * badge exists to make visible would have hidden.
 *
 * **Failure direction is chosen, not accidental.** Anything that isn't
 * unambiguously a public HTTPS hostname resolves to `internal_test`. A
 * production console mislabelled `INTERNAL TEST` is a visible false alarm;
 * an internal console mislabelled `PRODUCTION` would make the operator trust
 * the wrong cluster, which is the failure this badge exists to prevent.
 */
export type AdminEnvironment = 'production' | 'internal_test';

// Bare IPv4 literals (ubuntu01's `192.168.55.x` convention) and loopback/
// mDNS names are never the production hostname.
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const NON_PUBLIC_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function resolveAdminEnvironment(
  appPublicUrl: string | undefined,
): AdminEnvironment {
  if (!appPublicUrl) return 'internal_test';

  let url: URL;
  try {
    url = new URL(appPublicUrl.trim());
  } catch {
    // A malformed APP_PUBLIC_URL is a misconfiguration, not a production
    // signal — fall to the safe label rather than guessing.
    return 'internal_test';
  }

  // Plain HTTP is `ubuntu01`'s defining property (CLAUDE.md: "LAN-only
  // 192.168.55.x addresses, no public DNS/TLS"), so it alone settles it.
  if (url.protocol !== 'https:') return 'internal_test';

  const hostname = url.hostname.toLowerCase();
  if (NON_PUBLIC_HOSTNAMES.has(hostname)) return 'internal_test';
  if (IPV4_LITERAL.test(hostname)) return 'internal_test';
  if (hostname.endsWith('.local')) return 'internal_test';

  return 'production';
}
