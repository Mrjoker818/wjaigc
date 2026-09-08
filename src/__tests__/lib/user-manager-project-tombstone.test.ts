/**
 * 项目与图片删除墓碑机制测试
 *
 * 核心场景：删除项目/图片后，若云同步挂起（或延迟），随后的服务器数据加载
 * 不得将已删除内容"合并复活"。
 *
 * 墓碑设计：
 * - 内存 + localStorage（wujie_deletion_tombstones_v1）双持久化，刷新后可恢复
 * - 服务器端墓碑键（deletedProjectIds / deletedImageIds）提供跨设备防护
 * - 撤销恢复（Ctrl+Z）会主动清除墓碑，避免恢复内容被过滤
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserManager as UserManagerType } from '@/lib/user-manager';

const USER_ID = 'project-tombstone-user';

const makeImage = (id: string) => ({
  id,
  url: `https://example.com/${id}.png`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  originalWidth: 100,
  originalHeight: 100,
  rotation: 0,
  zIndex: 0,
  createdAt: 1,
});

const makeUser = () => ({
  id: USER_ID,
  name: 'Tombstone User',
  email: 'user@example.com',
  createdAt: 1,
  updatedAt: 2,
});

describe('UserManager project/image deletion tombstones', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let storageData: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    storageData = {};
    const storageMock = {
      getItem: vi.fn((key: string) => storageData[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageData[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storageData[key];
      }),
      clear: vi.fn(),
    };
    vi.stubGlobal('localStorage', storageMock);
    // jsdom 兜底
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storageMock, location: { reload: vi.fn() } },
    });

    // 静默控制台输出，避免 CI 误判
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 每个测试获取全新模块实例，避免单例状态跨测试污染 */
  const freshManager = async (): Promise<UserManagerType> => {
    const mod = await import('@/lib/user-manager');
    return mod.UserManager.getInstance();
  };

  it('does NOT resurrect a deleted project when the cloud sync stalls', async () => {
    const serverProjects = [
      { id: 'project-a', name: 'A', userId: USER_ID, createdAt: 1, updatedAt: 2, canvasImages: [] },
      { id: 'project-b', name: 'B', userId: USER_ID, createdAt: 1, updatedAt: 2, canvasImages: [] },
    ];

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        // 云同步挂起（网络延迟/失败），永不返回
        return new Promise(() => {});
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, value: serverProjects }),
      });
    });

    const manager = await freshManager();
    await manager.upsertUserFromServer(makeUser());
    await manager.loadProjectsFromServer(0);

    expect(manager.getProjects().map(p => p.id).sort()).toEqual(['project-a', 'project-b']);

    // 本地删除（云同步挂起，服务器仍持有旧数据）
    await manager.deleteProjects(['project-a']);
    expect(manager.getProjects().map(p => p.id)).toEqual(['project-b']);

    // 模拟随后的数据加载（刷新/重登录/定时同步返回旧数据）：
    // 内存墓碑仍然生效 → 不得复活 project-a
    await manager.loadProjectsFromServer(0);
    expect(manager.getProjects().map(p => p.id)).toEqual(['project-b']);
  });

  it('persists project and image tombstones across a page reload', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            value: [
              { id: 'project-a', name: 'A', userId: USER_ID, createdAt: 1, updatedAt: 2, canvasImages: [] },
            ],
          }),
      }),
    );

    const manager = await freshManager();
    await manager.upsertUserFromServer(makeUser());
    await manager.loadProjectsFromServer(0);
    expect(manager.getProjects().map(p => p.id)).toEqual(['project-a']);

    manager.recordDeletedImageIds(['image-a']);
    await manager.deleteProjects(['project-a']);

    // localStorage 中应写入统一键 + 新结构（{ projectIds, imageIds }）
    const stored = JSON.parse(storageData['wujie_deletion_tombstones_v1']);
    expect(stored[USER_ID].projectIds).toHaveProperty('project-a');
    expect(stored[USER_ID].imageIds).toHaveProperty('image-a');

    // 模拟"刷新页面"：重建模块与实例，从 localStorage 恢复墓碑
    vi.resetModules();
    const fresh = (await import('@/lib/user-manager')).UserManager.getInstance();

    // upsertUserFromServer 触发 hydrateDeletionTombstones
    await fresh.upsertUserFromServer(makeUser());

    expect(fresh.isRecentlyDeletedImage('image-a')).toBe(true);
    expect(fresh.isRecentlyDeletedProject('project-a')).toBe(true);
  });

  it('DataLossGuard must not resurrect tombstoned images (user deleted ALL images)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, value: [] }),
      }),
    );

    const manager = await freshManager();
    await manager.upsertUserFromServer(makeUser());
    await manager.loadProjectsFromServer(0);

    manager.createProject('Project C');
    const projectC = manager.getProjects().find(p => p.name === 'Project C');
    expect(projectC).toBeDefined();

    const images = Array.from({ length: 12 }, (_, i) => makeImage(`img-${i}`));
    // 第一次保存：建立 12 张图片基线 + 写入快照
    manager.updateProject(projectC!.id, { canvasImages: images });

    // 用户主动删除该项目全部图片
    const allIds = images.map(img => String(img.id));
    manager.recordDeletedImageIds(allIds);
    manager.updateProject(projectC!.id, { canvasImages: [] });

    // DataLossGuard 触发条件满足（last=12 >= 10, current=0），但全部图片在墓碑中 → 不得恢复
    const after = manager.getProjects().find(p => p.id === projectC!.id);
    expect(after!.canvasImages.length).toBe(0);

    // 基线应更新为 0，避免后续每次保存都重复尝试恢复
    expect(after!.canvasImages.length).toBe(0);
  });

  it('applies server-side deletion tombstones returned by the load endpoint', async () => {
    const serverProjects = [
      // 服务器物理删除尚未完成，仍返回 project-a（应被服务器墓碑过滤）
      { id: 'project-a', name: 'A', userId: USER_ID, createdAt: 1, updatedAt: 2, canvasImages: [] },
      {
        id: 'project-b',
        name: 'B',
        userId: USER_ID,
        createdAt: 1,
        updatedAt: 2,
        canvasImages: [makeImage('img-x'), makeImage('img-y')],
      },
    ];

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            value: serverProjects,
            deletedProjectIds: ['project-a'],
            deletedImageIds: ['img-x'],
          }),
      }),
    );

    const manager = await freshManager();
    await manager.upsertUserFromServer(makeUser());
    await manager.loadProjectsFromServer(0);

    const projects = manager.getProjects();
    expect(projects.map(p => p.id)).toEqual(['project-b']);
    const projectB = projects[0];
    expect(projectB.canvasImages.map(img => String((img as { id: string }).id))).toEqual(['img-y']);

    // 服务器墓碑应已应用到本地（跨设备防护）
    expect(manager.isRecentlyDeletedProject('project-a')).toBe(true);
    expect(manager.isRecentlyDeletedImage('img-x')).toBe(true);
  });

  it('clears image tombstones when images are restored (undo delete)', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, value: [] }),
      }),
    );

    const manager = await freshManager();
    await manager.upsertUserFromServer(makeUser());

    manager.recordDeletedImageIds(['img-r']);
    expect(manager.isRecentlyDeletedImage('img-r')).toBe(true);

    // Ctrl+Z 撤销删除 → 恢复的图片必须从墓碑中移除，否则会被同步/加载过滤掉
    manager.restoreDeletedImageIds(['img-r']);
    expect(manager.isRecentlyDeletedImage('img-r')).toBe(false);

    // localStorage 同步更新
    const stored = JSON.parse(storageData['wujie_deletion_tombstones_v1']);
    expect(stored[USER_ID].imageIds).not.toHaveProperty('img-r');
  });
});
