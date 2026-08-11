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
});
