import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSessionPayload } from '@/lib/auth-session';

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
});
