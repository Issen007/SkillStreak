import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkApiHealth } from '$lib/server/health';
import { listNetworkCandidates, pickLikelyPrimary } from '$lib/server/network';

// SkillStreak's own established local-dev ports (docker-compose.yml,
// mobile/README.md) -- this tool assumes the backend and Expo are already
// running, it doesn't start them.
const API_PORT = 3000;
const EXPO_METRO_PORT = 8081;

export interface StatusResponse {
  candidates: { interfaceName: string; address: string }[];
  selected: string | null;
  expoUrl: string | null;
  apiUrl: string | null;
  apiHealthy: boolean;
  checkedAt: string;
}

/** `?ip=` lets the frontend pin a specific candidate when the auto-detect
 * heuristic guesses wrong (see network.ts's header comment) -- re-evaluated
 * on every poll rather than cached server-side, since the whole point of
 * this tool is that the right answer can change between one request and
 * the next (a new network, a phone-hotspot switch mid-demo, etc). */
export const GET: RequestHandler = async ({ url }) => {
  const candidates = listNetworkCandidates();
  const requestedIp = url.searchParams.get('ip');
  const requested = requestedIp
    ? (candidates.find((c) => c.address === requestedIp) ?? null)
    : null;
  const selected = requested ?? pickLikelyPrimary(candidates);

  if (!selected) {
    return json(
      {
        candidates,
        selected: null,
        expoUrl: null,
        apiUrl: null,
        apiHealthy: false,
        checkedAt: new Date().toISOString(),
      } satisfies StatusResponse,
    );
  }

  const apiUrl = `http://${selected.address}:${API_PORT}`;
  const apiHealthy = await checkApiHealth(apiUrl);

  return json(
    {
      candidates,
      selected: selected.address,
      expoUrl: `exp://${selected.address}:${EXPO_METRO_PORT}`,
      apiUrl,
      apiHealthy,
      checkedAt: new Date().toISOString(),
    } satisfies StatusResponse,
  );
};
