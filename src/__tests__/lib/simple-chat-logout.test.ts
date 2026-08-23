import { describe, expect, it, vi } from 'vitest';

import { logoutSimpleChatSession } from '@/lib/simple-chat-logout';

describe('simple chat logout', () => {
  it('bounds a stalled final sync even when fetch ignores AbortSignal', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/user-data/sync') {
        return await new Promise<Response>(() => undefined);
      }
      return new Response('{}', { status: 200 });
    });

    const result = await Promise.race([
      logoutSimpleChatSession({
        projects: [{ id: 'chat-project' }],
        fetchImpl,
        syncTimeoutMs: 5,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('logout was not bounded')), 100);
      }),
    ]);

    expect(result).toEqual({ loggedOut: true, sync: 'timed-out' });
    expect(calls).toEqual(['/api/user-data/sync', '/api/auth/logout']);
  });

  it('keeps the authenticated UI when logout fails and the session remains active', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 });
      if (url === '/api/session') {
        return Response.json({ success: true, user: { id: 'user-1' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(logoutSimpleChatSession({ projects: [], fetchImpl })).resolves.toEqual({
      loggedOut: false,
      sync: 'skipped',
    });
  });

  it('accepts an already-anonymous session after a failed logout response', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 });
      if (url === '/api/session') return Response.json({ success: true, user: null });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(logoutSimpleChatSession({ projects: [], fetchImpl })).resolves.toEqual({
      loggedOut: true,
      sync: 'skipped',
    });
  });

  it('keeps the authenticated UI when session verification returns a service error payload', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/logout') return new Response('{}', { status: 503 });
      if (url === '/api/session') {
        return Response.json({ success: false, code: 'AUTH_SESSION_UNAVAILABLE' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(logoutSimpleChatSession({ projects: [], fetchImpl })).resolves.toEqual({
      loggedOut: false,
      sync: 'skipped',
    });
  });
});
