import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const storage = new Map<string, string>();

const project = {
  id: 'project-logout-sync',
  userId: 'logout-sync-user',
  name: 'Logout sync project',
  createdAt: 1,
  updatedAt: 1,
  canvasImages: [],
  settings: {},
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  storage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string | URL) => {
    const url = String(input);
    if (url === '/api/user-data/sync?key=projects') {
      return Promise.resolve(new Response(JSON.stringify({ success: true, value: [project] }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UserManager logout persistence', () => {
  it('flushes a pending project update before clearing the authenticated user', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();

    await manager.upsertUserFromServer({
      id: 'logout-sync-user',
      name: 'logout-sync-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    await manager.loadProjectsFromServer(0, 'logout-sync-user');

    manager.updateProject(project.id, {
      canvasImages: [{
        id: 'generated-before-logout',
        url: '/api/serve-upload/generated-before-logout.png',
        x: 0,
        y: 0,
        width: 800,
        height: 800,
        originalWidth: 800,
        originalHeight: 800,
        rotation: 0,
        zIndex: 0,
        createdAt: 2,
      }],
    });
    await manager.logout();

    const projectSyncCalls = fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === '/api/user-data/sync' && (init as RequestInit | undefined)?.method === 'POST'
    );

    expect(projectSyncCalls).toHaveLength(1);
    const payload = JSON.parse(String((projectSyncCalls[0][1] as RequestInit).body)) as {
      value: Array<{ id: string; canvasImages: Array<{ id: string }> }>;
    };
    expect(payload.value.find(item => item.id === project.id)?.canvasImages)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'generated-before-logout' })]));
  });

  it('waits for the project sync before starting the server logout request', async () => {
    let resolveProjectSync: ((response: Response) => void) | undefined;
    const pendingProjectSync = new Promise<Response>((resolve) => {
      resolveProjectSync = resolve;
    });

    fetchMock.mockReset();
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/user-data/sync?key=projects') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, value: [project] }), { status: 200 }));
      }
      if (url === '/api/user-data/sync' && init?.method === 'POST') {
        return pendingProjectSync;
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer({
      id: 'logout-sync-user',
      name: 'logout-sync-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    await manager.loadProjectsFromServer(0, 'logout-sync-user');
    manager.updateProject(project.id, {
      canvasImages: [{
        id: 'generated-before-server-logout',
        url: '/api/serve-upload/generated-before-server-logout.png',
        x: 0,
        y: 0,
        width: 800,
        height: 800,
        originalWidth: 800,
        originalHeight: 800,
        rotation: 0,
        zIndex: 0,
        createdAt: 2,
      }],
    });

    const logoutPromise = Promise.resolve(manager.logout());
    const logoutCallsBeforeSync = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/logout');
    expect(logoutCallsBeforeSync).toHaveLength(0);

    resolveProjectSync?.(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await logoutPromise;
    const logoutCallsAfterSync = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/logout');
    expect(logoutCallsAfterSync).toHaveLength(1);
  });

  it('allows a first project to sync when the server explicitly returns an empty project list', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url === '/api/user-data/sync?key=projects') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, value: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();

    await manager.upsertUserFromServer({
      id: 'first-project-user',
      name: 'first-project-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    await manager.loadProjectsFromServer(0, 'first-project-user');
    const firstProject = manager.createProject('First cloud project');

    await vi.advanceTimersByTimeAsync(2_000);

    const projectSyncCalls = fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === '/api/user-data/sync' && (init as RequestInit | undefined)?.method === 'POST'
    );
    expect(projectSyncCalls).toHaveLength(1);
    const payload = JSON.parse(String((projectSyncCalls[0][1] as RequestInit).body)) as {
      value: Array<{ id: string }>;
    };
    expect(payload.value).toEqual(expect.arrayContaining([expect.objectContaining({ id: firstProject.id })]));
  });
});
