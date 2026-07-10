/** True if `GET {url}` responds `2xx` within `timeoutMs` -- never throws, so
 * a demo network with nothing running yet just shows a red dot instead of
 * crashing the status endpoint. */
export async function checkUrlReachable(
  url: string,
  timeoutMs = 800,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** True if the backend's `/health` endpoint responds `2xx`. */
export async function checkApiHealth(
  baseUrl: string,
  timeoutMs = 800,
): Promise<boolean> {
  return checkUrlReachable(`${baseUrl}/health`, timeoutMs);
}
