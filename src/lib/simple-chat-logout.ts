export type SimpleChatLogoutSyncStatus = 'completed' | 'failed' | 'timed-out' | 'skipped';

interface SimpleChatLogoutOptions {
  projects: unknown[];
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

async function syncProjectsWithTimeout(
  projects: unknown[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SimpleChatLogoutSyncStatus> {
  if (projects.length === 0) return 'skipped';

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve()
    .then(() => fetchImpl('/api/user-data/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({ key: 'chat_simple_projects', value: projects }),
    }))
    .then(async (response) => {
      await consumeResponse(response);
      return response.ok ? 'completed' : 'failed';
    })
    .catch((): SimpleChatLogoutSyncStatus => 'failed');
  const deadline = new Promise<SimpleChatLogoutSyncStatus>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve('timed-out');
    }, timeoutMs);
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
  const sync = await syncProjectsWithTimeout(
    options.projects,
    fetchImpl,
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
