/** True if `GET {baseUrl}/health` responds `2xx` within `timeoutMs` --
 * never throws, so a demo network with no backend running yet just shows a
 * red dot instead of crashing the status endpoint. */
export async function checkApiHealth(
  baseUrl: string,
  timeoutMs = 800,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
