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

  it('makes the signed-in user available before a pending project sync resolves', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    let resolveSync: ((value: boolean) => void) | undefined;
    const syncSpy = vi.spyOn(manager, 'loadProjectsFromServer').mockImplementation(() => new Promise<boolean>(resolve => {
      resolveSync = resolve;
    }));

    await expect(manager.upsertUserFromServer({
      id: 'pending-sync-user',
      name: 'pending-sync-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })).resolves.toMatchObject({ id: 'pending-sync-user' });

    expect(syncSpy).toHaveBeenCalledOnce();
    expect(manager.getUser()).toMatchObject({ id: 'pending-sync-user' });

    resolveSync?.(true);
    await Promise.resolve();
  });
});
