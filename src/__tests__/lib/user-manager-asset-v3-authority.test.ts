import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const storage = new Map<string, string>();
const setItemMock = vi.fn((key: string, value: string) => storage.set(key, value));

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

const graphUpdate = (overrides: Record<string, unknown> = {}) => ({
  assetId: 'asset-retained',
  versionId: 'version-retained',
  placementId: 'placement-retained',
  url: '/media/retained.png',
  sourceUrl: null,
  thumbnailUrl: null,
  mediaAvailability: 'ready',
  mediaErrorCode: null,
  originalWidth: 600,
  originalHeight: 400,
  ...overrides,
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
  setItemMock.mockClear();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: setItemMock,
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('asset-v3 client project authority', () => {
  it('preserves a local upload added during GET before any debounced POST starts', async () => {
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { resolveResponse = resolve; }));
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    const loading = manager.loadProjectsFromServer(0, user.id);
    manager.updateProject('project-1', {
      canvasImages: [...manager.getProjects()[0].canvasImages, canvasImage('new-during-get', 20)],
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    resolveResponse(Response.json({ success: true, value: [project([canvasImage('retained', 44)])],
      assetGraphMode: 'shadow', projectRevision: 7, deletedCanvasPlacements: [] }));
    await expect(loading).resolves.toBe(false);
    expect(manager.getProjects()[0].canvasImages.map(image => image.id)).toContain('new-during-get');
    expect(manager.hasPendingProjectChanges()).toBe(true);
  });

  it('excludes an explicitly trashed shadow placement from the next save without losing local uploads', async () => {
    const deletedImage = {
      ...canvasImage('deleted-skill', 18),
      assetId: 'deleted-asset',
      assetVersionId: 'deleted-version',
      placementId: 'deleted-placement',
    };
    const seed = JSON.parse(storage.get('unbounded_ai_user_data')!);
    seed.userData[user.id].projects[0].canvasImages.push(deletedImage);
    storage.set('unbounded_ai_user_data', JSON.stringify(seed));
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          value: [project([canvasImage('retained', 44)])],
          assetGraphMode: 'shadow',
          projectRevision: 7,
          deletedCanvasPlacements: [{
            projectId: 'project-1', entityId: deletedImage.id,
            assetId: deletedImage.assetId, assetVersionId: deletedImage.assetVersionId,
            placementId: deletedImage.placementId,
          }],
        }), { status: 200 }));
      }
      if (String(input) === '/api/user-data/sync' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, projectRevision: 8 }), { status: 200 }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(true);
    expect(manager.getProjects()[0].canvasImages.map(image => image.id)).toEqual(['retained', 'local-only']);
    await manager.flushProjectsToServer();
    const posts = fetchMock.mock.calls.filter(([url, init]) => (
      String(url) === '/api/user-data/sync' && (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(posts.length).toBeGreaterThan(0);
    for (const [, init] of posts) {
      const payload = JSON.parse(String((init as RequestInit).body));
      expect(payload.value[0].canvasImages.map((image: { id: string }) => image.id))
        .toEqual(['retained', 'local-only']);
    }
  });

  it.each(['projectId', 'entityId', 'assetId', 'assetVersionId', 'placementId'] as const)(
    'does not discard a local managed image when the deletion %s differs', async (field) => {
      const local = {
        ...canvasImage('local-only', 8), assetId: 'asset-local',
        assetVersionId: 'version-local', placementId: 'placement-local',
      };
      const seed = JSON.parse(storage.get('unbounded_ai_user_data')!);
      seed.userData[user.id].projects[0].canvasImages[1] = local;
      storage.set('unbounded_ai_user_data', JSON.stringify(seed));
      const deletion = {
        projectId: 'project-1', entityId: local.id, assetId: local.assetId,
        assetVersionId: local.assetVersionId, placementId: local.placementId,
        [field]: 'different-identity',
      };
      fetchMock.mockResolvedValue(new Response(JSON.stringify({
        success: true, value: [project([canvasImage('retained', 44)])],
        assetGraphMode: 'shadow', projectRevision: 7, deletedCanvasPlacements: [deletion],
      }), { status: 200 }));
      const { UserManager } = await import('@/lib/user-manager');
      const manager = UserManager.getInstance();
      await manager.loadProjectsFromServer(0, user.id);
      expect(manager.getProjects()[0].canvasImages).toEqual(expect.arrayContaining([
        expect.objectContaining(local),
      ]));
    },
  );

  it('rejects a late deletion snapshot after an explicit restore advances the project revision', async () => {
    const local = {
      ...canvasImage('local-only', 8), assetId: 'asset-local',
      assetVersionId: 'version-local', placementId: 'placement-local',
    };
    const seed = JSON.parse(storage.get('unbounded_ai_user_data')!);
    seed.userData[user.id].projects[0].canvasImages[1] = local;
    storage.set('unbounded_ai_user_data', JSON.stringify(seed));
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { resolveResponse = resolve; }));
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    const loading = manager.loadProjectsFromServer(0, user.id);
    manager.advanceProjectSyncRevision(8);
    resolveResponse(Response.json({
      success: true, value: [project([canvasImage('retained', 44)])],
      assetGraphMode: 'shadow', projectRevision: 7,
      deletedCanvasPlacements: [{ projectId: 'project-1', entityId: local.id,
        assetId: local.assetId, assetVersionId: local.assetVersionId, placementId: local.placementId }],
    }));
    await expect(loading).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(8);
    expect(manager.getProjects()[0].canvasImages).toEqual(expect.arrayContaining([expect.objectContaining(local)]));
  });

  it('rejects malformed deletion records without dropping local images', async () => {
    fetchMock.mockResolvedValue(Response.json({
      success: true, value: [project([canvasImage('retained', 44)])],
      assetGraphMode: 'shadow', projectRevision: 7,
      deletedCanvasPlacements: [{ projectId: 'project-1', entityId: 'local-only' }],
    }));
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(false);
    expect(manager.getProjects()[0].canvasImages.map(image => image.id)).toContain('local-only');
  });

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

  it('does not schedule a second POST when the server graph response is field-for-field stable', async () => {
    const stableImage = {
      ...canvasImage('retained', 44),
      assetId: 'asset-retained',
      assetVersionId: 'version-retained',
      placementId: 'placement-retained',
      mediaAvailability: 'ready' as const,
    };
    const serverProject = project([stableImage]);
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          value: [serverProject],
          assetGraphMode: 'shadow',
        }), { status: 200 }));
      }
      if (String(input) === '/api/user-data/sync' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          assetGraphMappings: {
            'project-1': {
              retained: {
                assetId: 'asset-retained',
                versionId: 'version-retained',
                placementId: 'placement-retained',
              },
            },
          },
          assetGraphUpdates: { 'project-1': { retained: graphUpdate() } },
        }), { status: 200 }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(true);
    const writesBeforeFlush = setItemMock.mock.calls.filter(([key]) => key === 'unbounded_ai_user_data').length;
    await manager.flushProjectsToServer();
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
    expect(setItemMock.mock.calls.filter(([key]) => key === 'unbounded_ai_user_data')).toHaveLength(writesBeforeFlush);

    await vi.advanceTimersByTimeAsync(2_001);

    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('applies one canonical media update locally and never feeds it back through the scheduler', async () => {
    const encodedImage = {
      ...canvasImage('retained', 44),
      url: 'data:image/png;base64,AAAA',
      sourceUrl: 'data:image/png;base64,BBBB',
    };
    const serverProject = project([encodedImage]);
    const canonical = graphUpdate({
      url: '/api/serve-upload/uploads/canonical.png',
      sourceUrl: '/api/serve-upload/uploads/source.png',
      thumbnailUrl: '/api/serve-upload/uploads/thumb.png',
      originalWidth: 1024,
      originalHeight: 768,
    });
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          value: [serverProject],
          assetGraphMode: 'shadow',
        }), { status: 200 }));
      }
      if (String(input) === '/api/user-data/sync' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          assetGraphUpdates: { 'project-1': { retained: canonical } },
        }), { status: 200 }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(true);
    const writesBeforeFlush = setItemMock.mock.calls.filter(([key]) => key === 'unbounded_ai_user_data').length;
    await manager.flushProjectsToServer();

    expect(manager.getProjects()[0].canvasImages[0]).toMatchObject({
      url: '/api/serve-upload/uploads/canonical.png',
      sourceUrl: '/api/serve-upload/uploads/source.png',
      thumbnailUrl: '/api/serve-upload/uploads/thumb.png',
      assetId: 'asset-retained',
      assetVersionId: 'version-retained',
      placementId: 'placement-retained',
      originalWidth: 1024,
      originalHeight: 768,
    });
    expect(setItemMock.mock.calls.filter(([key]) => key === 'unbounded_ai_user_data')).toHaveLength(writesBeforeFlush + 1);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);

    await manager.flushProjectsToServer();
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    const secondPayload = JSON.parse(String((posts[1][1] as RequestInit).body)) as {
      value: Array<{ canvasImages: Array<{ url: string; sourceUrl?: string }> }>;
    };
    expect(secondPayload.value[0].canvasImages[0]).toMatchObject({
      url: '/api/serve-upload/uploads/canonical.png',
      sourceUrl: '/api/serve-upload/uploads/source.png',
    });
    expect(JSON.stringify(secondPayload)).not.toContain('data:image');
    await vi.advanceTimersByTimeAsync(2_001);
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(2);
  });
});
