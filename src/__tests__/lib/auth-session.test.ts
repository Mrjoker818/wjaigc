import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSessionPayload, resolveSessionUser } from '@/lib/auth-session';
import type { User } from '@/lib/user-types';

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchSessionPayload', () => {
  it('rejects and aborts when a browser-wrapped fetch never settles', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const request = fetchSessionPayload(hangingFetch, 10);
    const rejectedRequest = expect(request).rejects.toThrow('Session request timed out');
    await vi.advanceTimersByTimeAsync(10);

    await rejectedRequest;
    expect(requestSignal?.aborted).toBe(true);
    expect(hangingFetch).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include',
    }));
  });

  it('preserves an authenticated user when the session service returns a transient failure', () => {
    const authenticatedUser = {
      id: 'user-1',
      name: 'Authenticated user',
      role: 'user',
    } as User;

    expect(resolveSessionUser(authenticatedUser, {
      success: false,
    })).toEqual({ status: 'indeterminate', user: authenticatedUser });
  });

  it('clears an authenticated user only when the session service explicitly reports no user', () => {
    const authenticatedUser = {
      id: 'user-1',
      name: 'Authenticated user',
      role: 'user',
    } as User;

    expect(resolveSessionUser(authenticatedUser, {
      success: true,
      user: null,
    })).toEqual({ status: 'unauthenticated', user: null });
  });
});
