import { API_BASE_URL, API_PREFIX } from './config';
import { getSessionToken } from './authStorage';
import { ApiError } from './ApiError';
import type { ApiErrorBody } from './types';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Attach `Authorization: Bearer <sessionToken>` — omit for the two
   * unauthenticated onboarding endpoints (invite preview, create player). */
  auth?: boolean;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.auth) {
    const token = await getSessionToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // Network-level failure (backend down, no connectivity, wrong host) —
    // not a shape the contract defines, so it gets its own client-only code
    // rather than pretending it's a server error envelope.
    throw new ApiError(
      'network_error',
      'Could not reach the SkillStreak server.',
      0,
    );
  }

  const text = await response.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) {
    if (isApiErrorBody(json)) {
      throw new ApiError(json.error.code, json.error.message, response.status);
    }
    throw new ApiError('unknown_error', 'Unexpected error.', response.status);
  }

  return json as T;
}

export const apiClient = { request };
