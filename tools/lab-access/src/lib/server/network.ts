import os from 'node:os';

export interface NetworkCandidate {
  interfaceName: string;
  address: string;
}

// This project's own dev machine has a WireGuard VPN (wg0) and several
// Docker bridges (docker0, br-...) alongside the real Wi-Fi adapter, all of
// which show up as ordinary non-internal IPv4 addresses -- naively picking
// "the first IPv4 address found" would occasionally hand out a VPN or
// container-bridge IP that a phone on the same Wi-Fi can never reach. These
// are excluded from being the *guessed* primary, but still listed as
// candidates so a user whose real adapter happens to match one of these
// names can still pick it manually.
const EXCLUDED_INTERFACE_PATTERN =
  /^(lo|docker|br-|veth|wg|tun|utun|awdl|llw|anpi)/i;
// Conventional Wi-Fi/Ethernet adapter names across Linux (wlp*, enp*),
// macOS (en0), and Windows (Wi-Fi, Ethernet) -- preferred when more than one
// eligible candidate remains.
const PREFERRED_INTERFACE_PATTERN = /^(wl|en|eth|wi-?fi|ethernet)/i;

/** Every non-internal IPv4 address on this machine, labeled by interface
 * name. Takes `os.networkInterfaces()`'s return value as a parameter
 * (rather than calling it internally) purely so this stays a pure,
 * unit-testable function -- the `+server.ts` route is the only real
 * caller. */
export function listNetworkCandidates(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): NetworkCandidate[] {
  const candidates: NetworkCandidate[] = [];
  for (const [interfaceName, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      candidates.push({ interfaceName, address: addr.address });
    }
  }
  return candidates;
}

/**
 * Best-effort guess at which candidate is the machine's real LAN adapter --
 * never authoritative. The UI always shows every candidate from
 * `listNetworkCandidates` alongside this guess so a demo doesn't silently
 * break because the heuristic picked a VPN/container interface instead of
 * the Wi-Fi one; the guess just saves the common case from requiring a
 * manual pick every time.
 */
export function pickLikelyPrimary(
  candidates: NetworkCandidate[],
): NetworkCandidate | null {
  const eligible = candidates.filter(
    (c) => !EXCLUDED_INTERFACE_PATTERN.test(c.interfaceName),
  );
  const pool = eligible.length > 0 ? eligible : candidates;
  const preferred = pool.find((c) =>
    PREFERRED_INTERFACE_PATTERN.test(c.interfaceName),
  );
  return preferred ?? pool[0] ?? null;
}
