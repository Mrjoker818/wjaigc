export type SimpleChatLogoutSyncStatus = 'completed' | 'failed' | 'timed-out' | 'skipped';

export interface SimpleChatLogoutOptions {
  flush: () => Promise<void>;
  fetchImpl?: typeof fetch;
  syncTimeoutMs?: number;
}

interface SimpleChatLogoutResult {
  loggedOut: boolean;
  sync: SimpleChatLogoutSyncStatus;
}

async function consumeResponse(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    // The status and cookie mutation remain authoritative if the body stream closes early.
  }
}

async function flushWithTimeout(
  flush: () => Promise<void>,
  timeoutMs: number,
): Promise<SimpleChatLogoutSyncStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve()
    .then(flush)
    .then((): SimpleChatLogoutSyncStatus => 'completed')
    .catch((): SimpleChatLogoutSyncStatus => 'failed');
  const deadline = new Promise<SimpleChatLogoutSyncStatus>((resolve) => {
    timeout = setTimeout(() => {
      resolve('timed-out');
    }, Math.max(0, timeoutMs));
  });

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function sessionIsAnonymous(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (response.status === 401) return true;
    if (!response.ok) return false;
    const payload = await response.json() as { success?: unknown; user?: unknown };
    return payload.success === true && payload.user === null;
  } catch {
    return false;
  }
}

export async function logoutSimpleChatSession(
  options: SimpleChatLogoutOptions,
): Promise<SimpleChatLogoutResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sync = await flushWithTimeout(
    options.flush,
    options.syncTimeoutMs ?? 5_000,
  );

  try {
    const response = await fetchImpl('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    await consumeResponse(response);
    if (response.ok) return { loggedOut: true, sync };
  } catch {
    // Verify whether the session was invalidated despite a transport failure.
  }

  return {
    loggedOut: await sessionIsAnonymous(fetchImpl),
    sync,
  };
}
