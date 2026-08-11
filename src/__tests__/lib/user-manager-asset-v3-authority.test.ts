import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const storage = new Map<string, string>();

const user = {
  id: 'asset-v3-user',
  name: 'asset-v3-user',
  role: 'user' as const,
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1,
};

const canvasImage = (id: string, x: number) => ({
  id,
  url: `/media/${id}.png`,
  x,
  y: 2,
  width: 300,
  height: 200,
  originalWidth: 600,
  originalHeight: 400,
  rotation: 0,
  zIndex: 1,
  createdAt: 1,
});

const project = (images: ReturnType<typeof canvasImage>[]) => ({
  id: 'project-1',
  userId: user.id,
  name: 'Project',
  createdAt: 1,
  updatedAt: 1,
  settings: {},
  canvasImages: images,
});

function seedLocalProjects(): void {
  storage.set('unbounded_ai_current_user', user.id);
  storage.set('unbounded_ai_user_data', JSON.stringify({
    users: [user],
    userData: {
      [user.id]: {
        user,
        projects: [project([canvasImage('retained', 999), canvasImage('local-only', 8)])],
        apiKeys: [],
        usageStats: [],
      },
    },
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  storage.clear();
  seedLocalProjects();
  fetchMock.mockReset();
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

describe('asset-v3 client project authority', () => {
  it('uses graph placement geometry and deletion through load and the next autosave payload', async () => {
    const serverProject = project([canvasImage('retained', 44)]);
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          value: [serverProject],
          assetGraphMode: 'asset-v3',
        }), { status: 200 }));
      }
      if (String(input) === '/api/user-data/sync' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(true);
    expect(manager.getProjects()[0].canvasImages).toEqual([
      expect.objectContaining({ id: 'retained', x: 44 }),
    ]);

    await manager.flushProjectsToServer();
    const post = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === '/api/user-data/sync' && (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(post).toBeDefined();
    const payload = JSON.parse(String((post![1] as RequestInit).body)) as {
      value: Array<{ canvasImages: Array<{ id: string; x: number }> }>;
    };
    expect(payload.value[0].canvasImages).toEqual([
      expect.objectContaining({ id: 'retained', x: 44 }),
    ]);
  });

  it.each(['legacy', 'shadow'] as const)('preserves the compatible union merge in %s mode', async (mode) => {
    const serverProject = project([canvasImage('retained', 44)]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      value: [serverProject],
      assetGraphMode: mode,
    }), { status: 200 }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(true);
    expect(manager.getProjects()[0].canvasImages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'retained', x: 999 }),
      expect.objectContaining({ id: 'local-only', x: 8 }),
    ]));
  });
});
