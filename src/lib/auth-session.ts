import type { User } from './user-types';

export interface SessionPayload {
  success?: boolean;
  user?: User | null;
}

type SessionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const AUTH_SESSION_TIMEOUT_MS = 8_000;

/**
 * Browser extensions may replace fetch and leave its Promise pending without
 * honoring AbortSignal. Race the whole response parsing step so UI state can
 * always leave its authentication loading state.
 */
export async function fetchSessionPayload(
  request: SessionFetch = fetch,
  timeoutMs = AUTH_SESSION_TIMEOUT_MS,
  endpoint = '/api/session',
): Promise<SessionPayload> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const requestPromise = Promise.resolve()
    .then(() => request(endpoint, {
      cache: 'no-store',
      credentials: 'include',
      signal: controller.signal,
    }))
    .then(async (response) => response.json() as Promise<SessionPayload>);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('Session request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
