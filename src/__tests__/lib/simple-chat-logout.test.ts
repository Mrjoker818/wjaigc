import { describe, expect, it, vi } from 'vitest';

import { logoutSimpleChatSession } from '@/lib/simple-chat-logout';

describe('simple chat logout', () => {
  it('flushes before logout without posting an independent project snapshot', async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => { order.push('flush'); });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      order.push(String(input));
      return new Response('{}', { status: 200 });
    });

    await expect(logoutSimpleChatSession({ flush, fetchImpl })).resolves.toEqual({ loggedOut: true, sync: 'completed' });
    expect(order).toEqual(['flush', '/api/auth/logout']);
  });

  it('continues logout after a rejected flush', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response('{}', { status: 200 });
    });

    await expect(logoutSimpleChatSession({
      flush: vi.fn(async () => { throw new Error('sync failed'); }), fetchImpl,
    })).resolves.toEqual({ loggedOut: true, sync: 'failed' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toBe('/api/auth/logout');
  });

  it('bounds a stalled flush even when it cannot be aborted', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response('{}', { status: 200 });
    });
    const result = await Promise.race([
      logoutSimpleChatSession({
        flush: () => new Promise<void>(() => undefined), fetchImpl, syncTimeoutMs: 5,
      }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('logout was not bounded')), 100)),
    ]);

    expect(result).toEqual({ loggedOut: true, sync: 'timed-out' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toBe('/api/auth/logout');
  });

  it('keeps the authenticated UI when logout fails and the session remains active', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 });
      if (url === '/api/session') return Response.json({ success: true, user: { id: 'user-1' } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(logoutSimpleChatSession({ flush: vi.fn(), fetchImpl })).resolves.toEqual({ loggedOut: false, sync: 'completed' });
  });

  it('accepts an already-anonymous session after a failed logout response', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 });
      if (url === '/api/session') return Response.json({ success: true, user: null });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(logoutSimpleChatSession({ flush: vi.fn(), fetchImpl })).resolves.toEqual({ loggedOut: true, sync: 'completed' });
  });

  it('keeps the authenticated UI when session verification returns a service error payload', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 });
      if (url === '/api/session') return Response.json({ success: false, code: 'AUTH_SESSION_UNAVAILABLE' });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(logoutSimpleChatSession({ flush: vi.fn(), fetchImpl })).resolves.toEqual({ loggedOut: false, sync: 'completed' });
  });
});
