import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const storage = new Map<string, string>();

const projects = ['project-a', 'project-b', 'project-c'].map((id, index) => ({
  id,
  userId: 'project-delete-user',
  name: `Project ${index + 1}`,
  createdAt: index + 1,
  updatedAt: index + 1,
  canvasImages: [],
  settings: {},
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  storage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/user-data/sync?key=projects') {
      return Promise.resolve(new Response(JSON.stringify({ success: true, value: projects }), { status: 200 }));
    }
    if (url === '/api/user-data/sync' && init?.method === 'POST') {
      return new Promise<Response>(() => {});
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

describe('UserManager project deletion', () => {
  it('finishes an optimistic batch deletion without waiting for a stalled cloud sync', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer({
      id: 'project-delete-user',
      name: 'project-delete-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    await manager.loadProjectsFromServer(0, 'project-delete-user');

    let settled = false;
    const deletion = manager.deleteProjects(['project-a', 'project-b']).then(result => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(deletion).resolves.toEqual({
      deletedIds: ['project-a', 'project-b'],
      skippedIds: [],
    });
    expect(manager.getProjects().map(project => project.id)).toEqual(['project-c']);
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === '/api/user-data/sync' && (init as RequestInit | undefined)?.method === 'POST'
    )).toHaveLength(1);
  });
});
