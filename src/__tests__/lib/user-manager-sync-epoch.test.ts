import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hydrateCanvasPlacements,
  serializeCanvasWorkspacePlacements,
} from '@/lib/asset-core/canvas-adapter';
import type { Project } from '@/lib/user-types';

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

type PendingFailureMode = 'rollback' | 'settle-remove';

async function leaveUnsettledAdoptionPending(failureMode: PendingFailureMode) {
  let revision = 1;
  let serverProjects = [project('user-a', '/media/base.png')];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    success: true,
    value: serverProjects,
    assetGraphMode: 'shadow',
    projectRevision: revision,
  }), { status: 200 })));

  const { UserManager } = await import('@/lib/user-manager');
  const manager = UserManager.getInstance();
  await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
  manager.updateProject('project-a', {
    name: 'Local draft',
    canvasImages: [canvasImage('/media/local-draft.png')],
  });
  serverProjects = [project('user-a', '/media/remote-winner.png')];
  revision = 2;

  let mainWriteCount = 0;
  let adoptionWriteCount = 0;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === 'unbounded_ai_user_data') {
        mainWriteCount += 1;
        if (failureMode === 'rollback' && mainWriteCount > 1) {
          throw new DOMException('rollback quota', 'QuotaExceededError');
        }
      }
      if (key.includes('project_adoption_commit')) {
        adoptionWriteCount += 1;
        if (adoptionWriteCount > 1) {
          throw new DOMException('envelope quota', 'QuotaExceededError');
        }
      }
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      if (failureMode === 'settle-remove' && key.includes('project_adoption_commit')) {
        throw new DOMException('remove blocked', 'InvalidStateError');
      }
      storage.delete(key);
    },
  });

  await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
  const commitKey = [...storage.keys()].find((key) => key.includes('project_adoption_commit'))!;
  expect(JSON.parse(storage.get(commitKey)!)).toMatchObject({
    revision: 1,
    pending: { startedAt: expect.any(Number) },
  });
  expect(manager.getProject('project-a')).toEqual(expect.objectContaining({
    name: 'Local draft',
    canvasImages: [expect.objectContaining({ url: '/media/local-draft.png' })],
  }));
  return { manager, commitKey };
}

function installHealthyStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
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
  it('does not rebase and retry a document-authority conflict as an ordinary revision race', async () => {
    let readCount = 0;
    let writeCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        readCount += 1;
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/a.png')],
          assetGraphMode: 'shadow',
          projectRevision: 1,
        }), { status: 200 });
      }
      writeCount += 1;
      return new Response(JSON.stringify({
        success: false,
        code: 'DOCUMENT_AUTHORITY_CONFLICT',
        error: 'Collaborative canvas is document-authoritative',
      }), { status: 409 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    const beforeWriteReads = readCount;
    manager.updateProject('project-a', { name: 'Local stale title', updatedAt: 2 });
    await vi.advanceTimersByTimeAsync(2_001);

    expect(readCount).toBe(beforeWriteReads);
    expect(writeCount).toBe(1);
    expect(manager.getProject('project-a')?.name).toBe('Local stale title');
    expect(manager.hasPendingProjectChanges()).toBe(true);
  });

  it('updates an immediate canvas snapshot in memory without serializing local storage', async () => {
    const setItem = vi.fn((key: string, value: string) => storage.set(key, value));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem,
      removeItem: (key: string) => storage.delete(key),
    });

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    setItem.mockClear();

    const updated = manager.updateProjectInMemory('project-a', { name: 'Immediate canvas draft' });

    expect(updated?.name).toBe('Immediate canvas draft');
    expect(manager.hasPendingProjectChanges()).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('adopts the authenticated canvas mode while treating the cached copy as untrusted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: [project('user-a', '/media/a.png')],
      assetGraphMode: 'legacy',
      canvasKernelMode: 'shadow',
      projectRevision: 1,
    }), { status: 200 })));

    const firstModule = await import('@/lib/user-manager');
    const firstManager = firstModule.UserManager.getInstance();
    await expect(firstManager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    expect(firstManager.getCanvasKernelMode()).toBe('shadow');

    const commitKey = [...storage.keys()].find((key) => key.includes('project_adoption_commit'));
    expect(commitKey).toBeTruthy();
    const cachedCommit = JSON.parse(storage.get(commitKey!)!);
    expect(cachedCommit.canvasKernelMode).toBe('shadow');

    cachedCommit.canvasKernelMode = 'canvas-v2';
    storage.set(commitKey!, JSON.stringify(cachedCommit));
    vi.resetModules();
    const reloadedModule = await import('@/lib/user-manager');
    const reloadedManager = reloadedModule.UserManager.getInstance();
    expect(reloadedManager.getCanvasKernelMode()).toBe('legacy');
  });

  it('tracks only mutations that have not reached an accepted server revision', async () => {
    let revision = 1;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') revision += 1;
      return new Response(JSON.stringify({
        success: true,
        value: [project('user-a', '/media/a.png')],
        assetGraphMode: 'shadow',
        projectRevision: revision,
      }), { status: 200 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    expect(manager.hasPendingProjectChanges()).toBe(false);

    manager.updateProject('project-a', { name: 'Changed' });
    expect(manager.hasPendingProjectChanges()).toBe(true);

    await expect(manager.flushProjectsToServer()).resolves.toBeTruthy();
    expect(manager.hasPendingProjectChanges()).toBe(false);
  });

  it('uses a persisted per-user authoritative base after reload and preserves twelve remote deletions', async () => {
    const images = Array.from({ length: 13 }, (_, index) => (
      imageWithId(`remote-${index}`, `/media/remote-${index}.png`)
    ));
    let revision = 1;
    let serverProjects = [{ ...project('user-a', '/media/a.png'), canvasImages: images }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: serverProjects,
      assetGraphMode: 'shadow',
      projectRevision: revision,
    }), { status: 200 })));
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users,
      userData: {
        'user-a': { user: users[0], projects: serverProjects, apiKeys: [], usageStats: [] },
        'user-b': { user: users[1], projects: [project('user-b', '/media/b.png')], apiKeys: [], usageStats: [] },
      },
    }));

    const firstModule = await import('@/lib/user-manager');
    const firstManager = firstModule.UserManager.getInstance();
    await expect(firstManager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    expect(firstManager.getProject('project-a')?.canvasImages).toHaveLength(13);
    const baseKey = [...storage.keys()].find((key) => (
      key.includes('project_adoption_commit') && key.includes('user-a')
    ));
    expect(baseKey).toBeTruthy();
    expect(JSON.parse(storage.get(baseKey!)!)).toMatchObject({
      version: 2,
      userId: 'user-a',
      revision: 1,
      authoritativeBase: [expect.objectContaining({ id: 'project-a' })],
      adoptedDraft: [expect.objectContaining({ id: 'project-a' })],
    });
    expect(new TextEncoder().encode(storage.get(baseKey!)!).byteLength).toBeLessThanOrEqual(12_000_000);

    serverProjects = [{ ...serverProjects[0], updatedAt: 2, canvasImages: [images[12]] }];
    revision = 2;
    vi.resetModules();
    const reloadedModule = await import('@/lib/user-manager');
    const reloadedManager = reloadedModule.UserManager.getInstance();
    await expect(reloadedManager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    expect(reloadedManager.getProject('project-a')?.canvasImages.map((item) => item.id)).toEqual(['remote-12']);
  });

  it('does not adopt a revision or remote winner when a required conflict backup exceeds quota', async () => {
    let revision = 1;
    let serverProjects = [project('user-a', '/media/base.png')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: serverProjects,
      assetGraphMode: 'shadow',
      projectRevision: revision,
    }), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-draft.png')] });
    serverProjects = [project('user-a', '/media/remote-winner.png')];
    revision = 2;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key.includes('project_adoption_commit')) throw new DOMException('quota', 'QuotaExceededError');
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key),
    });

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(1);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');
  });

  it('rejects a malformed per-user conflict backup before adopting remote conflict state', async () => {
    let revision = 1;
    let serverProjects = [project('user-a', '/media/base.png')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: serverProjects,
      assetGraphMode: 'shadow',
      projectRevision: revision,
    }), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-draft.png')] });
    const commitKey = [...storage.keys()].find((key) => key.includes('project_adoption_commit'));
    expect(commitKey).toBeTruthy();
    const malformedCommit = JSON.parse(storage.get(commitKey!)!);
    malformedCommit.conflictBackups = [{
      id: 'backup-malformed',
      userId: 'user-a',
      projectId: 'project-a',
      imageId: 'image-a',
      conflictType: 'concurrent-image-edit',
      localValue: { ...canvasImage('/media/local.png'), width: -1 },
      remoteValue: canvasImage('/media/remote.png'),
      createdAt: Date.now(),
    }];
    storage.set(commitKey!, JSON.stringify(malformedCommit));
    serverProjects = [project('user-a', '/media/remote-winner.png')];
    revision = 2;

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(1);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');
  });

  it('does not adopt a response revision before the project payload parses and validates', async () => {
    let responseBody: Record<string, unknown> = {
      success: true,
      value: [project('user-a', '/media/base.png')],
      assetGraphMode: 'shadow',
      projectRevision: 3,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responseBody), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    responseBody = {
      success: true,
      value: '{broken-json',
      assetGraphMode: 'asset-v3',
      projectRevision: 9,
    };

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(3);
    expect(manager.getAssetGraphMode()).toBe('shadow');
  });

  it('does not patch a newer local mutation with an in-flight POST response', async () => {
    const response = deferredResponse();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/base.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return response.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    const request = manager.flushProjectsToServer();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    manager.updateProject('project-a', {
      canvasImages: [canvasImage('/media/newer-local.png')],
      name: 'Newer local name',
    });
    response.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 1,
      projectIdMap: { 'project-a': 'project-canonical' },
      assetGraphUpdates: {
        'project-a': { 'image-shared': graphUpdate('/media/stale-canonical.png', 'version-stale') },
      },
    }), { status: 200 }));
    await request;

    expect(manager.getProject('project-a')).toBeNull();
    expect(manager.getProject('project-canonical')).toMatchObject({
      name: 'Newer local name',
      canvasImages: [expect.objectContaining({ url: '/media/newer-local.png' })],
    });
    expect(manager.getProjectSyncRevision()).toBe(1);
  });

  it('rolls back a POST canonical patch when the persistent authoritative base cannot be written', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/base.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        projectRevision: 1,
        assetGraphUpdates: {
          'project-a': { 'image-shared': graphUpdate('/media/canonical.png', 'version-canonical') },
        },
      }), { status: 200 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key.includes('project_adoption_commit')) throw new DOMException('quota', 'QuotaExceededError');
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key),
    });

    await expect(manager.flushProjectsToServer()).rejects.toThrow('quota');

    expect(manager.getProjectSyncRevision()).toBe(0);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/base.png');
    expect(manager.getProject('project-a')?.canvasImages[0]?.assetVersionId).toBeUndefined();
  });

  it('backs up every remote-wins image and project conflict in a versioned user-scoped envelope', async () => {
    const mainBase: Project = {
      ...project('user-a', '/media/unused.png', 'project-a'),
      name: 'Main base',
      metadata: { label: 'base' },
      canvasImages: [
        imageWithId('remote-delete', '/media/remote-delete-base.png'),
        imageWithId('local-delete', '/media/local-delete-base.png'),
      ],
    };
    const remoteDeleteBase: Project = {
      ...project('user-a', '/media/project-remote-delete.png', 'project-remote-delete'),
      name: 'Remote delete base',
    };
    const localDeleteBase: Project = {
      ...project('user-a', '/media/project-local-delete.png', 'project-local-delete'),
      name: 'Local delete base',
    };
    let revision = 1;
    let serverProjects = [mainBase, remoteDeleteBase, localDeleteBase];
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users,
      userData: {
        'user-a': { user: users[0], projects: serverProjects, apiKeys: [], usageStats: [] },
        'user-b': { user: users[1], projects: [project('user-b', '/media/b.png')], apiKeys: [], usageStats: [] },
      },
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: serverProjects,
          assetGraphMode: 'shadow',
          projectRevision: revision,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, currentRevision: revision }), { status: 409 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    manager.updateProject('project-a', {
      name: 'Main local',
      metadata: { label: 'local' },
      canvasImages: [imageWithId('remote-delete', '/media/remote-delete-local-edit.png')],
    });
    manager.updateProject('project-remote-delete', { name: 'Remote delete local edit' });
    await manager.deleteProjects(['project-local-delete']);

    serverProjects = [{
      ...mainBase,
      name: 'Main remote',
      metadata: { label: 'remote' },
      updatedAt: 4,
      canvasImages: [imageWithId('local-delete', '/media/local-delete-remote-edit.png')],
    }, {
      ...localDeleteBase,
      name: 'Local delete remote edit',
      updatedAt: 4,
    }];
    revision = 2;
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    expect(manager.getProject('project-a')).toMatchObject({
      name: 'Main remote',
      metadata: { label: 'remote' },
      canvasImages: [expect.objectContaining({
        id: 'local-delete',
        url: '/media/local-delete-remote-edit.png',
      })],
    });
    expect(manager.getProject('project-remote-delete')).toBeNull();
    expect(manager.getProject('project-local-delete')?.name).toBe('Local delete remote edit');

    const backupKey = [...storage.keys()].find((key) => (
      key.includes('project_adoption_commit') && key.includes('user-a')
    ));
    expect(backupKey).toBeTruthy();
    const envelope = JSON.parse(storage.get(backupKey!)!) as {
      version: number;
      userId: string;
      conflictBackups: Array<{ conflictType: string }>;
    };
    expect(envelope).toMatchObject({ version: 2, userId: 'user-a' });
    expect(envelope.conflictBackups).toHaveLength(5);
    expect(envelope.conflictBackups.map((entry) => entry.conflictType)).toEqual(expect.arrayContaining([
      'remote-image-delete-local-edit',
      'local-image-delete-remote-edit',
      'concurrent-project-edit',
      'remote-project-delete-local-edit',
      'local-project-delete-remote-edit',
    ]));
    expect(envelope.conflictBackups.length).toBeLessThanOrEqual(50);
  });

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
    const commitKey = [...storage.keys()].find((key) => key.includes('project_adoption_commit'));
    expect(storage.get(commitKey!)).toContain('/media/local-draft.png');

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

  it('rebases and retries one guarded flush after a revision conflict', async () => {
    const initial = project('user-a', '/media/base.png');
    const remoteImage = imageWithId('remote-addition', '/media/remote.png');
    const localImage = imageWithId('local-addition', '/media/local.png');
    let revision = 0;
    let serverProjects = [structuredClone(initial)];
    let firstPost = true;
    const postBodies: Array<{ projectRevision: number; value: ReturnType<typeof project>[] }> = [];

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
      postBodies.push(structuredClone(body));
      if (firstPost) {
        firstPost = false;
        serverProjects = [{
          ...structuredClone(initial),
          updatedAt: 2,
          canvasImages: [canvasImage('/media/base.png'), remoteImage],
        }];
        revision = 1;
        return new Response(JSON.stringify({
          success: false,
          error: 'Canvas project snapshot is stale',
          currentRevision: revision,
        }), { status: 409 });
      }
      if (body.projectRevision !== revision) {
        return new Response(JSON.stringify({
          success: false,
          currentRevision: revision,
        }), { status: 409 });
      }
      serverProjects = structuredClone(body.value);
      revision += 1;
      return new Response(JSON.stringify({ success: true, projectRevision: revision }), { status: 200 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    manager.updateProjectInMemory('project-a', {
      updatedAt: 3,
      canvasImages: [canvasImage('/media/base.png'), localImage],
    });

    await expect(manager.flushProjectsToServerWithConflictRecovery()).resolves.toBeTruthy();

    expect(postBodies.map(body => body.projectRevision)).toEqual([0, 1]);
    expect(serverProjects[0].canvasImages.map(image => image.id)).toEqual([
      'image-shared',
      'remote-addition',
      'local-addition',
    ]);
    expect(manager.getProjectSyncRevision()).toBe(2);
  });

  it('rebases debounced autosave once after 409 without resurrecting the remote deletion', async () => {
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

    expect(postBodies.map((body) => body.projectRevision)).toEqual([0, 0, 1]);
    expect(revision).toBe(2);
    expect(serverProjects[0].canvasImages).toEqual([]);
    expect(manager.getProjectSyncRevision()).toBe(2);
    expect(manager.getProject('project-a')?.canvasImages).toEqual([]);
  });

  it('serializes rapid project flushes and submits the latest draft at the accepted revision', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const postBodies: Array<Record<string, unknown>> = [];
    let postCount = 0;
    let activePosts = 0;
    let maxActivePosts = 0;
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
      activePosts += 1;
      maxActivePosts = Math.max(maxActivePosts, activePosts);
      const response = await (postCount === 1 ? first.promise : second.promise);
      activePosts -= 1;
      return response;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    const firstRequest = manager.flushProjectsToServer();
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-new.png')] });
    const secondRequest = manager.flushProjectsToServer();

    await vi.waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]?.projectRevision).toBe(0);

    first.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 1,
    }), { status: 200 }));
    await firstRequest;
    await vi.waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[1]?.projectRevision).toBe(1);
    expect(postBodies[1]?.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'project-a',
        canvasImages: [expect.objectContaining({ url: '/media/local-new.png' })],
      }),
    ]));

    second.resolve(new Response(JSON.stringify({
      success: true,
      projectRevision: 2,
    }), { status: 200 }));
    await secondRequest;

    expect(postBodies).toHaveLength(2);
    expect(maxActivePosts).toBe(1);
    expect(manager.getProjectSyncRevision()).toBe(2);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-new.png');
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

  it('ignores an older same-user GET that resolves after a newer revision', async () => {
    const older = deferredResponse();
    const newer = deferredResponse();
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      getCount += 1;
      if (getCount === 1) {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/base.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return getCount === 2 ? older.promise : newer.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);

    const olderLoad = manager.loadProjectsFromServer(0, 'user-a');
    const newerLoad = manager.loadProjectsFromServer(0, 'user-a');
    newer.resolve(new Response(JSON.stringify({
      success: true,
      value: [project('user-a', '/media/revision-2.png')],
      assetGraphMode: 'shadow',
      projectRevision: 2,
    }), { status: 200 }));
    await expect(newerLoad).resolves.toBe(true);

    older.resolve(new Response(JSON.stringify({
      success: true,
      value: [project('user-a', '/media/revision-1.png')],
      assetGraphMode: 'shadow',
      projectRevision: 1,
    }), { status: 200 }));
    await expect(olderLoad).resolves.toBe(false);

    expect(manager.getProjectSyncRevision()).toBe(2);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/revision-2.png');
    const commit = JSON.parse(storage.get('unbounded_ai_project_adoption_commit_v2:user-a')!) as {
      revision: number;
      authoritativeBase: Project[];
    };
    expect(commit.revision).toBe(2);
    expect(commit.authoritativeBase[0]?.canvasImages[0]?.url).toBe('/media/revision-2.png');
  });

  it('does not let a successful in-flight GET patch update, create, delete, or import mutations', async () => {
    const staleGet = deferredResponse();
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input) !== '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({ success: false, currentRevision: 0 }), { status: 409 });
      }
      getCount += 1;
      if (getCount === 1) {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/base.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return staleGet.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    const load = manager.loadProjectsFromServer(0, 'user-a');

    manager.updateProject('project-a', { name: 'Local update during GET' });
    const created = manager.createProject('Created during GET');
    const deleted = manager.createProject('Deleted during GET');
    await manager.deleteProjects([deleted.id]);
    const imported = manager.importProjectFromWujie(JSON.stringify({
      format: 'wujie-project',
      version: '1.0',
      exportedAt: 1,
      project: project('user-a', '/media/imported.png', 'project-import-source'),
    }));

    staleGet.resolve(new Response(JSON.stringify({
      success: true,
      value: [{ ...project('user-a', '/media/remote.png'), name: 'Remote stale winner', updatedAt: 9 }],
      assetGraphMode: 'shadow',
      projectRevision: 1,
    }), { status: 200 }));
    await expect(load).resolves.toBe(false);

    expect(manager.getProject('project-a')?.name).toBe('Local update during GET');
    expect(manager.getProject(created.id)?.name).toBe('Created during GET');
    expect(manager.getProject(deleted.id)).toBeNull();
    expect(manager.getProject(imported.id)?.canvasImages[0]?.url).toBe('/media/imported.png');
    expect(manager.getProjectSyncRevision()).toBe(0);
  });

  it('keeps a request-time mutation when malformed GET data fails after JSON parsing', async () => {
    const malformedGet = deferredResponse();
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      getCount += 1;
      if (getCount === 1) {
        return new Response(JSON.stringify({
          success: true,
          value: [project('user-a', '/media/base.png')],
          assetGraphMode: 'shadow',
          projectRevision: 0,
        }), { status: 200 });
      }
      return malformedGet.promise;
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    const load = manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', { name: 'Mutation survives malformed GET' });
    malformedGet.resolve(new Response(JSON.stringify({
      success: true,
      value: [{
        ...project('user-a', '/media/invalid.png'),
        canvasImages: [{ ...canvasImage('/media/invalid.png'), url: 123 }],
      }],
      assetGraphMode: 'shadow',
      projectRevision: 1,
    }), { status: 200 }));

    await expect(load).resolves.toBe(false);
    expect(manager.getProject('project-a')?.name).toBe('Mutation survives malformed GET');
    expect(manager.getProjectSyncRevision()).toBe(0);
  });

  it.each([
    ['invalid image geometry', [{
      ...project('user-a', '/media/invalid.png'),
      canvasImages: [{ ...canvasImage('/media/invalid.png'), width: 'wide' }],
    }]],
    ['invalid project fields', [{ ...project('user-a', '/media/invalid.png'), name: 42 }]],
    ['invalid legacy settings type', [{ ...project('user-a', '/media/invalid.png'), settings: [] }]],
  ])('rejects parseable server payload with %s', async (_label, invalidProjects) => {
    let body: Record<string, unknown> = {
      success: true,
      value: [project('user-a', '/media/base.png')],
      assetGraphMode: 'shadow',
      projectRevision: 4,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    body = {
      success: true,
      value: invalidProjects,
      assetGraphMode: 'asset-v3',
      projectRevision: 5,
    };

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(4);
    expect(manager.getAssetGraphMode()).toBe('shadow');
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/base.png');
  });

  it('opens an approved legacy v1 project on fresh login by filling safe compatibility defaults', async () => {
    const seeded = JSON.parse(storage.get('unbounded_ai_user_data')!) as {
      userData: Record<string, { projects: unknown[] }>;
    };
    seeded.userData['user-a'].projects = [];
    storage.set('unbounded_ai_user_data', JSON.stringify(seeded));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: [{
        id: 'legacy-project',
        userId: 'user-a',
        name: 'Legacy project',
        images: [{ id: 'legacy-image', url: '/uploads/legacy.png' }],
      }],
      assetGraphMode: 'legacy',
      projectRevision: 1,
    }), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    expect(manager.getProject('legacy-project')).toEqual(expect.objectContaining({
      id: 'legacy-project',
      userId: 'user-a',
      name: 'Legacy project',
      schemaVersion: 1,
      createdAt: 0,
      updatedAt: 0,
      settings: {},
      canvasImages: [expect.objectContaining({
        id: 'legacy-image',
        url: '/api/serve-upload/uploads/legacy.png',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        originalWidth: 1,
        originalHeight: 1,
        rotation: 0,
        zIndex: 0,
        createdAt: 0,
      })],
    }));
    expect(manager.getProjectSyncRevision()).toBe(1);
  });

  it.each([
    ['project ID', [
      project('user-a', '/media/duplicate-project-a.png', 'duplicate-project'),
      project('user-a', '/media/duplicate-project-b.png', 'duplicate-project'),
    ]],
    ['image ID', [{
      ...project('user-a', '/media/base.png'),
      canvasImages: [
        imageWithId('duplicate-image', '/media/duplicate-image-a.png'),
        imageWithId('duplicate-image', '/media/duplicate-image-b.png'),
      ],
    }]],
    ['placement ID', [{
      ...project('user-a', '/media/base.png'),
      canvasImages: [
        imageWithId('image-a', '/media/placement-a.png', { placementId: 'duplicate-placement' }),
        imageWithId('image-b', '/media/placement-b.png', { placementId: 'duplicate-placement' }),
      ],
    }]],
  ])('rejects duplicate %s before polluting revision, base, or draft', async (_identity, duplicates) => {
    let body: Record<string, unknown> = {
      success: true,
      value: [project('user-a', '/media/base.png')],
      assetGraphMode: 'shadow',
      projectRevision: 4,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(true);
    const commitKey = [...storage.keys()].find((key) => key.includes('project_adoption_commit'))!;
    const acceptedCommit = storage.get(commitKey);

    body = {
      success: true,
      value: duplicates,
      assetGraphMode: 'asset-v3',
      projectRevision: 5,
    };

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(4);
    expect(manager.getAssetGraphMode()).toBe('shadow');
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/base.png');
    expect(storage.get(commitKey)).toBe(acceptedCommit);
  });

  it('rejects a GET revision older than both memory and the persisted commit', async () => {
    let body = {
      success: true,
      value: [project('user-a', '/media/revision-5.png')],
      assetGraphMode: 'shadow' as const,
      projectRevision: 5,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    body = {
      success: true,
      value: [project('user-a', '/media/revision-4.png')],
      assetGraphMode: 'shadow',
      projectRevision: 4,
    };

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(5);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/revision-5.png');
  });

  it('does not restore a login-start snapshot over a newer same-user mutation when initialization fails', async () => {
    const loadResult = deferredValue<boolean>();
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    vi.spyOn(manager, 'loadProjectsFromServer').mockReturnValue(loadResult.promise);

    await manager.upsertUserFromServer(users[0]);
    manager.updateProject('project-a', { name: 'Mutation after login started' });
    loadResult.resolve(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getProject('project-a')?.name).toBe('Mutation after login started');
  });

  it('fails adoption when the canonical draft key cannot be written and recovers the local draft on reload', async () => {
    let revision = 1;
    let serverProjects = [project('user-a', '/media/base.png')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: serverProjects,
      assetGraphMode: 'shadow',
      projectRevision: revision,
    }), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-draft.png')] });
    serverProjects = [project('user-a', '/media/remote-winner.png')];
    revision = 2;
    let rejectedMainWrites = 0;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === 'unbounded_ai_user_data') {
          rejectedMainWrites += 1;
          throw new DOMException('quota', 'QuotaExceededError');
        }
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key),
    });

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(rejectedMainWrites).toBeGreaterThan(0);
    expect(manager.getProjectSyncRevision()).toBe(1);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.resetModules();
    const reloadedModule = await import('@/lib/user-manager');
    const reloaded = reloadedModule.UserManager.getInstance();
    expect(reloaded.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');
    expect(reloaded.getProjectSyncRevision()).toBe(1);

    reloaded.updateProject('project-a', { name: 'Mutation after pending recovery' });
    vi.resetModules();
    const secondReloadModule = await import('@/lib/user-manager');
    const secondReload = secondReloadModule.UserManager.getInstance();
    expect(secondReload.getProject('project-a')?.name).toBe('Mutation after pending recovery');
  });

  it('recovers the pre-adoption draft when the single commit envelope write fails after the main write', async () => {
    let revision = 1;
    let serverProjects = [project('user-a', '/media/base.png')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: serverProjects,
      assetGraphMode: 'shadow',
      projectRevision: revision,
    }), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-draft.png')] });
    serverProjects = [project('user-a', '/media/remote-winner.png')];
    revision = 2;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key.includes('project_adoption_commit')) {
          const parsed = JSON.parse(value) as { revision?: number };
          if (parsed.revision === 2) throw new DOMException('quota', 'QuotaExceededError');
        }
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key),
    });

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(1);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');
    const commitKey = [...storage.keys()].find((key) => key.includes('project_adoption_commit'))!;
    expect(JSON.parse(storage.get(commitKey)!)).toMatchObject({ revision: 1 });
    expect(JSON.parse(storage.get(commitKey)!).pending).toBeUndefined();

    manager.updateProject('project-a', { name: 'Mutation after failed adoption' });
    vi.resetModules();
    const reloadedModule = await import('@/lib/user-manager');
    const reloaded = reloadedModule.UserManager.getInstance();
    expect(reloaded.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');
    expect(reloaded.getProject('project-a')?.name).toBe('Mutation after failed adoption');
    expect(reloaded.getProjectSyncRevision()).toBe(1);
  });

  it.each([
    ['updateProject', 'Updated after pending recovery'],
    ['createProject', 'Created after pending recovery'],
    ['deleteProject', ''],
    ['importProjectFromWujie', 'Imported after pending recovery'],
  ] as const)('settles a rollback-failure pending marker before %s and preserves the mutation on reload', async (
    mutation,
    expectedName,
  ) => {
    const { manager, commitKey } = await leaveUnsettledAdoptionPending('rollback');
    installHealthyStorage();
    let affectedProjectId = 'project-a';

    if (mutation === 'updateProject') {
      manager.updateProject('project-a', { name: expectedName });
    } else if (mutation === 'createProject') {
      affectedProjectId = manager.createProject(expectedName).id;
    } else if (mutation === 'deleteProject') {
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
      await expect(manager.deleteProject('project-a')).resolves.toBe(true);
    } else {
      affectedProjectId = manager.importProjectFromWujie(JSON.stringify({
        format: 'wujie-project',
        version: '1.0',
        exportedAt: 1,
        project: { ...project('user-a', '/media/imported.png'), name: expectedName },
      })).id;
    }

    expect(JSON.parse(storage.get(commitKey)!)).not.toHaveProperty('pending');
    vi.resetModules();
    const reloadedModule = await import('@/lib/user-manager');
    const reloaded = reloadedModule.UserManager.getInstance();
    if (mutation === 'deleteProject') {
      expect(reloaded.getProject(affectedProjectId)).toBeNull();
    } else {
      expect(reloaded.getProject(affectedProjectId)?.name).toBe(expectedName);
    }
  });

  it.each([
    'updateProject',
    'createProject',
    'deleteProject',
    'importProjectFromWujie',
  ] as const)('rejects %s without changing memory when a pending marker cannot settle or be removed', async (mutation) => {
    const { manager, commitKey } = await leaveUnsettledAdoptionPending('settle-remove');
    const projectsBefore = structuredClone(manager.getProjects());

    const mutate = async () => {
      if (mutation === 'updateProject') {
        manager.updateProject('project-a', { name: 'Must not survive' });
      } else if (mutation === 'createProject') {
        manager.createProject('Must not survive');
      } else if (mutation === 'deleteProject') {
        await manager.deleteProject('project-a');
      } else {
        manager.importProjectFromWujie(JSON.stringify({
          format: 'wujie-project',
          version: '1.0',
          exportedAt: 1,
          project: { ...project('user-a', '/media/rejected-import.png'), name: 'Must not survive' },
        }));
      }
    };

    await expect(mutate()).rejects.toThrow('PROJECT_SYNC_PENDING_RECOVERY_FAILED');
    expect(manager.getProjects()).toEqual(projectsBefore);
    expect(JSON.parse(storage.get(commitKey)!)).toHaveProperty('pending');
  });

  it('fails remote-wins adoption when browser storage becomes unavailable', async () => {
    let revision = 1;
    let serverProjects = [project('user-a', '/media/base.png')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      value: serverProjects,
      assetGraphMode: 'shadow',
      projectRevision: revision,
    }), { status: 200 })));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    manager.updateProject('project-a', { canvasImages: [canvasImage('/media/local-draft.png')] });
    serverProjects = [project('user-a', '/media/remote-winner.png')];
    revision = 2;
    vi.stubGlobal('localStorage', undefined);

    await expect(manager.loadProjectsFromServer(0, 'user-a')).resolves.toBe(false);
    expect(manager.getProjectSyncRevision()).toBe(1);
    expect(manager.getProject('project-a')?.canvasImages[0]?.url).toBe('/media/local-draft.png');
  });

  it('preserves unmanaged missing and blob placements through autosave payload and reopen hydration', async () => {
    let revision = 0;
    let serverProjects = [project('user-a', '/media/base.png')];
    const posted: Project[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) === '/api/user-data/sync?key=projects') {
        return new Response(JSON.stringify({
          success: true,
          value: serverProjects,
          assetGraphMode: 'shadow',
          projectRevision: revision,
        }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { value: Project[] };
      posted.push(structuredClone(body.value));
      serverProjects = structuredClone(body.value);
      revision += 1;
      return new Response(JSON.stringify({ success: true, projectRevision: revision }), { status: 200 });
    }));

    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.loadProjectsFromServer(0, 'user-a');
    const autosavePlacements = serializeCanvasWorkspacePlacements([
      imageWithId('missing-empty', '', { mediaAvailability: 'missing', mediaErrorCode: 'MEDIA_LOAD_FAILED' }),
      imageWithId('missing-blob', 'blob:expired-session-media'),
    ]);
    manager.updateProject('project-a', { canvasImages: autosavePlacements });
    await manager.flushProjectsToServer();

    expect(posted.at(-1)?.[0]?.canvasImages).toEqual([
      expect.objectContaining({ id: 'missing-empty', url: '', mediaAvailability: 'missing' }),
      expect.objectContaining({ id: 'missing-blob', url: 'blob:expired-session-media', mediaAvailability: 'missing' }),
    ]);

    vi.resetModules();
    const reloadedModule = await import('@/lib/user-manager');
    const reloaded = reloadedModule.UserManager.getInstance();
    await reloaded.loadProjectsFromServer(0, 'user-a');
    const reopened = hydrateCanvasPlacements(reloaded.getProject('project-a')!.canvasImages);
    expect(reopened.map((image) => [image.id, image.mediaAvailability])).toEqual([
      ['missing-empty', 'missing'],
      ['missing-blob', 'missing'],
    ]);
  });
});
