import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, value: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('user login server synchronization', () => {
  it('does not call an administrator-only folder endpoint for a regular user', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();

    await manager.upsertUserFromServer({
      id: 'regular-user',
      name: 'regular-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });

    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain('/api/user-data/sync?key=projects');
    expect(requestedUrls).not.toContain('/api/admin/user-folder');
  });
});
