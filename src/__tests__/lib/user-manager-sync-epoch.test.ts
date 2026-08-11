import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

const users = [
  { id: 'user-a', name: 'A', role: 'user' as const, status: 'active' as const, createdAt: 1, updatedAt: 1 },
  { id: 'user-b', name: 'B', role: 'user' as const, status: 'active' as const, createdAt: 1, updatedAt: 1 },
];

const canvasImage = (url: string) => ({
  id: 'image-shared',
  url,
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  originalWidth: 600,
  originalHeight: 400,
  rotation: 0,
  zIndex: 1,
  createdAt: 1,
});

const imageWithId = (id: string, url: string, overrides: Record<string, unknown> = {}) => ({
  ...canvasImage(url),
  id,
  ...overrides,
});

const project = (userId: string, url: string, id = `project-${userId.slice(-1)}`) => ({
  id,
  userId,
  name: `Project ${userId}`,
  createdAt: 1,
  updatedAt: 1,
  settings: {},
  canvasImages: [canvasImage(url)],
});

const graphUpdate = (url: string, versionId: string) => ({
  assetId: 'asset-shared',
  versionId,
  placementId: 'placement-shared',
  url,
  sourceUrl: url,
  thumbnailUrl: url,
  mediaAvailability: 'ready',
  mediaErrorCode: null,
  originalWidth: 600,
  originalHeight: 400,
});

const deferredResponse = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const deferredValue = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

function seedUsers(): void {
  storage.set('unbounded_ai_current_user', 'user-a');
  storage.set('unbounded_ai_user_data', JSON.stringify({
    users,
    userData: {
      'user-a': { user: users[0], projects: [project('user-a', '/media/a.png')], apiKeys: [], usageStats: [] },
      'user-b': { user: users[1], projects: [project('user-b', '/media/b.png')], apiKeys: [], usageStats: [] },
    },
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  storage.clear();
  seedUsers();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UserManager project sync response isolation', () => {
  it('rebases a rev0 conflict through GET and later autosave without resurrecting a remote deletion', async () => {
    const initial = {
      ...project('user-a', '/media/deleted.png'),
      canvasImages: [
        imageWithId('deleted-remotely', '/media/deleted.png'),
        imageWithId('safe-local-edit', '/media/safe.png'),
        imageWithId('concurrent-edit', '/media/base.png'),
      ],
    };
    let revision = 0;
    let serverProjects = [structuredClone(initial)];
    const postBodies: Array<{ projectRevision: number; value: typeof serverProjects }> = [];
    const heldResponse = deferredResponse();
    const heldRequestStarted = deferredValue<void>();
    let heldBody: { projectRevision: number; value: typeof serverProjects } | null = null;

    const applyCas = (body: { projectRevision: number; value: typeof serverProjects }): Response => {
      if (body.projectRevision !== revision) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Canvas project snapshot is stale',
          currentRevision: revision,
        }), { status: 409 });
      }
      serverProjects = structuredClone(body.value);
      revision += 1;
      return new Response(JSON.stringify({ success: true, projectRevision: revision }), { status: 200 });
    };

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: serverProjects,
          assetGraphMode: 'shadow',
          projectRevision: revision,
        }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body || '{}')) as {
        projectRevision: number;
        value: typeof serverProjects;
      };
      postBodies.push(structuredClone(body));
      if (postBodies.length === 1) {
        heldBody = body;
        heldRequestStarted.resolve();
        return heldResponse.promise;
      }
      return applyCas(body);
    }));

    const { ProjectSyncConflictError, UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users,
      userData: {
        'user-a': { user: users[0], projects: [initial], apiKeys: [], usageStats: [] },
        'user-b': { user: users[1], projects: [project('user-b', '/media/b.png')], apiKeys: [], usageStats: [] },
      },
    }));
    Reflect.set(manager, 'multiUserData', JSON.parse(storage.get('unbounded_ai_user_data')!));
    await manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', {
      canvasImages: [
        imageWithId('deleted-remotely', '/media/deleted.png'),
        imageWithId('safe-local-edit', '/media/safe.png', { x: 91 }),
        imageWithId('concurrent-edit', '/media/local-draft.png'),
        imageWithId('local-addition', '/media/local-addition.png'),
      ],
      updatedAt: 2,
    });

    const staleRequest = manager.flushProjectsToServer();
    await heldRequestStarted.promise;
    const remoteWinner = await fetch('/api/user-data/sync', {
      method: 'POST',
      body: JSON.stringify({
        key: 'projects',
        projectRevision: 0,
        value: [{
          ...initial,
          updatedAt: 3,
          canvasImages: [
            imageWithId('safe-local-edit', '/media/safe.png'),
            imageWithId('concurrent-edit', '/media/remote-winner.png'),
          ],
        }],
      }),
    });
    expect(remoteWinner.status).toBe(200);
    heldResponse.resolve(applyCas(heldBody!));

    await expect(staleRequest).rejects.toMatchObject({
      name: ProjectSyncConflictError.name,
      message: expect.stringMatching(/refresh|reload|sync|重试|刷新/i),
    });
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    const rebased = manager.getProject('project-a')!;
    expect(rebased.canvasImages.map((item) => item.id)).toEqual([
      'safe-local-edit',
      'concurrent-edit',
      'local-addition',
    ]);
    expect(rebased.canvasImages.find((item) => item.id === 'safe-local-edit')?.x).toBe(91);
    expect(rebased.canvasImages.find((item) => item.id === 'concurrent-edit')?.url).toBe('/media/remote-winner.png');
    expect(storage.get('unbounded_ai_project_conflict_backups')).toContain('/media/local-draft.png');

    manager.updateProject('project-a', {
      canvasImages: rebased.canvasImages.map((item) => (
        item.id === 'local-addition' ? { ...item, x: 144 } : item
      )),
      updatedAt: 4,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await vi.waitFor(() => expect(manager.isProjectSyncInFlight()).toBe(false));

    expect(postBodies.map((body) => body.projectRevision)).toEqual([0, 0, 1]);
    expect(serverProjects[0].canvasImages.some((item) => item.id === 'deleted-remotely')).toBe(false);
    expect(serverProjects[0].canvasImages.find((item) => item.id === 'local-addition')?.x).toBe(144);
  });

  it('preserves a local deletion when the authoritative placement is unchanged', async () => {
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) !== '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({ success: true, projectRevision: 2 }), { status: 200 });
      }
      getCount += 1;
      return new Response(JSON.stringify({
        success: true,
        value: [project('user-a', '/media/a.png')],
        assetGraphMode: 'shadow',
        projectRevision: getCount,
      }), { status: 200 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', { canvasImages: [], updatedAt: 2 });
    await manager.loadProjectsFromServer(0, 'user-a');

    expect(manager.getProject('project-a')?.canvasImages).toEqual([]);
  });
  it('stops on a realistic rev0 conflict without replaying the stale snapshot at rev1', async () => {
    let revision = 0;
    let serverProjects = [project('user-a', '/media/a.png')];
    const postBodies: Array<{ projectRevision: number; value: ReturnType<typeof project>[] }> = [];
    const heldResponse = deferredResponse();
    const heldRequestStarted = deferredValue<void>();
    let heldBody: { projectRevision: number; value: ReturnType<typeof project>[] } | null = null;

    const applyCas = (body: { projectRevision: number; value: ReturnType<typeof project>[] }): Response => {
      if (body.projectRevision !== revision) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Canvas project snapshot is stale',
          currentRevision: revision,
        }), { status: 409 });
      }
      serverProjects = structuredClone(body.value);
      revision += 1;
      return new Response(JSON.stringify({ success: true, projectRevision: revision }), { status: 200 });
    };

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: serverProjects,
          assetGraphMode: 'shadow',
          projectRevision: revision,
        }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body || '{}')) as {
        projectRevision: number;
        value: ReturnType<typeof project>[];
      };
      postBodies.push(body);
      if (postBodies.length === 1) {
        heldBody = body;
        heldRequestStarted.resolve();
        return heldResponse.promise;
      }
      return applyCas(body);
    }));

    const { ProjectSyncConflictError, UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    const requestB = manager.flushProjectsToServer();
    await heldRequestStarted.promise;

    const requestA = await fetch('/api/user-data/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'projects',
        projectRevision: 0,
        value: [{ ...project('user-a', '/media/a.png'), canvasImages: [] }],
      }),
    });
    expect(requestA.status).toBe(200);
    heldResponse.resolve(applyCas(heldBody!));

    await expect(requestB).rejects.toBeInstanceOf(ProjectSyncConflictError);
    expect(postBodies.map((body) => body.projectRevision)).toEqual([0, 0]);
    expect(revision).toBe(1);
    expect(serverProjects[0].canvasImages).toEqual([]);
    expect(manager.getProjectSyncRevision()).toBe(0);
    expect(manager.getProject('project-a')?.canvasImages).toHaveLength(1);
  });

  it('stops debounced autosave on 409 without replaying its stale snapshot at rev1', async () => {
    let revision = 0;
    let serverProjects = [project('user-a', '/media/a.png')];
    const postBodies: Array<{ projectRevision: number; value: ReturnType<typeof project>[] }> = [];
    const heldResponse = deferredResponse();
    const heldRequestStarted = deferredValue<void>();
    let heldBody: { projectRevision: number; value: ReturnType<typeof project>[] } | null = null;

    const applyCas = (body: { projectRevision: number; value: ReturnType<typeof project>[] }): Response => {
      if (body.projectRevision !== revision) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Canvas project snapshot is stale',
          currentRevision: revision,
        }), { status: 409 });
      }
      serverProjects = structuredClone(body.value);
      revision += 1;
      return new Response(JSON.stringify({ success: true, projectRevision: revision }), { status: 200 });
    };

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: serverProjects,
          assetGraphMode: 'shadow',
          projectRevision: revision,
        }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body || '{}')) as {
        projectRevision: number;
        value: ReturnType<typeof project>[];
      };
      postBodies.push(body);
      if (postBodies.length === 1) {
        heldBody = body;
        heldRequestStarted.resolve();
        return heldResponse.promise;
      }
      return applyCas(body);
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await vi.advanceTimersByTimeAsync(2_001);
    await manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', { updatedAt: 2 });
    await vi.advanceTimersByTimeAsync(2_001);
    await heldRequestStarted.promise;

    const requestA = await fetch('/api/user-data/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'projects',
        projectRevision: 0,
        value: [{ ...project('user-a', '/media/a.png'), canvasImages: [] }],
      }),
    });
    expect(requestA.status).toBe(200);
    heldResponse.resolve(applyCas(heldBody!));
    await vi.waitFor(() => {
      expect(manager.isProjectSyncInFlight()).toBe(false);
    });

    expect(postBodies.map((body) => body.projectRevision)).toEqual([0, 0]);
    expect(revision).toBe(1);
    expect(serverProjects[0].canvasImages).toEqual([]);
    expect(manager.getProjectSyncRevision()).toBe(0);
    expect(manager.getProject('project-a')?.canvasImages).toHaveLength(1);
  });

  it('ignores an older POST response after a newer revision converges', async () => {
    const older = deferredResponse();
    const newer = deferredResponse();
    const postBodies: Array<Record<string, unknown>> = [];
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/a.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      postBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      postCount += 1;
      return postCount === 1 ? older.promise : newer.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    const olderRequest = manager.flushProjectsToServer();
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-new.png')] });
    const newerRequest = manager.flushProjectsToServer();

    newer.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 1,
      assetGraphUpdates: { 'project-a': { 'image-shared': graphUpdate('/media/canonical-new.png', 'version-new') } },
    }), { status: 200 }));
    await newerRequest;
    manager.recordDeletedImageIds(['image-shared']);

    older.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 1,
      assetGraphUpdates: { 'project-a': { 'image-shared': graphUpdate('/media/canonical-old.png', 'version-old') } },
    }), { status: 200 }));
    await olderRequest;

    expect(postBodies).toHaveLength(2);
    expect(postBodies.map((body) => body.projectRevision)).toEqual([0, 0]);
    expect(manager.getProject('project-a')?.canvasImages[0]).toMatchObject({
      url: '/media/canonical-new.png',
      assetVersionId: 'version-new',
    });
    expect(manager.isRecentlyDeletedImage('image-shared')).toBe(true);
  });

  it('does not apply a user A response after the local session switches to user B', async () => {
    const userAResponse = deferredResponse();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/a.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return userAResponse.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    const request = manager.flushProjectsToServer();
    manager.setCurrentUser('user-b');

    userAResponse.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 1,
      assetGraphUpdates: { 'project-b': { 'image-shared': graphUpdate('/media/a-late.png', 'version-a-late') } },
    }), { status: 200 }));
    await request;

    expect(manager.getCurrentUserId()).toBe('user-b');
    expect(manager.getProject('project-b')?.canvasImages[0]).toMatchObject({ url: '/media/b.png' });
    expect(manager.getProject('project-b')?.canvasImages[0]?.assetVersionId).toBeUndefined();
  });

  it('keeps project sync marked in flight until its response body is parsed', async () => {
    const postResponse = deferredResponse();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/a.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return postResponse.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    const request = manager.flushProjectsToServer();
    await Promise.resolve();
    const inFlight = Reflect.get(manager, 'isProjectSyncInFlight') as undefined | (() => boolean);
    const whilePending = inFlight?.call(manager);

    postResponse.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 1,
    }), { status: 200 }));
    await request;

    expect(inFlight).toBeTypeOf('function');
    expect(whilePending).toBe(true);
    expect(inFlight?.call(manager)).toBe(false);
  });

  it('scopes in-flight request tokens to the active session and ignores an old completion', async () => {
    const userAResponse = deferredResponse();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/a.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return userAResponse.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    const oldRequest = manager.flushProjectsToServer();
    await Promise.resolve();
    expect(manager.isProjectSyncInFlight()).toBe(true);

    manager.setCurrentUser('user-b');
    expect(manager.isProjectSyncInFlight()).toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(0);

    userAResponse.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 7,
      assetGraphUpdates: { 'project-b': { 'image-shared': graphUpdate('/media/late-a.png', 'version-late-a') } },
    }), { status: 200 }));
    await oldRequest;

    expect(manager.isProjectSyncInFlight()).toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(0);
    expect(manager.getProject('project-b')?.canvasImages[0]?.url).toBe('/media/b.png');
  });

  it('rejects a GET response when the user switches while response json is pending', async () => {
    const responseJson = deferredValue<{
      success: boolean;
      value: ReturnType<typeof project>[];
      assetGraphMode: 'shadow';
      projectRevision: number;
    }>();
    const jsonStarted = deferredValue<void>();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => {
        jsonStarted.resolve();
        return responseJson.promise;
      },
    }) as Response));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    const load = manager.loadProjectsFromServer(0, 'user-a');
    await jsonStarted.promise;
    manager.setCurrentUser('user-b');
    responseJson.resolve({
      success: true,
      value: [project('user-a', '/media/a-late.png')],
      assetGraphMode: 'shadow',
      projectRevision: 9,
    });

    await expect(load).resolves.toBe(false);
    expect(manager.getCurrentUserId()).toBe('user-b');
    expect(manager.getAssetGraphMode()).toBe('legacy');
    expect(manager.getProjectSyncRevision()).toBe(0);
    expect(manager.getProject('project-b')?.canvasImages[0]?.url).toBe('/media/b.png');
  });

  it('commits unchanged periodic GET state locally without scheduling a POST', async () => {
    let postCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/a.png')],
          assetGraphMode: 'shadow',
          projectRevision: 4,
        }), { status: 200 });
      }
      postCount += 1;
      return new Response(JSON.stringify({ success: true, projectRevision: 5 }), { status: 200 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await vi.advanceTimersByTimeAsync(2_001);
    expect(postCount).toBe(0);
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(2_001);

    expect(manager.getProjectSyncRevision()).toBe(4);
    expect(postCount).toBe(0);
  });
});
