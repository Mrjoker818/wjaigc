import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟服务器同步永远挂起（stalled），用于复现"删除后同步失败，项目被服务器端合并恢复"的场景
const fetchMock = vi.fn();
const storage = new Map<string, string>();

// 服务器端依然保留的全部项目（模拟"删除未被服务器接受"的旧数据状态）
const serverProjects = ['project-a', 'project-b', 'project-c'].map((id, index) => ({
  id,
  userId: 'project-tombstone-user',
  name: `Project ${index + 1}`,
  createdAt: index + 1,
  updatedAt: index + 1,
  canvasImages: [],
  settings: {},
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  // 静默源码中的正常防御性日志（如 [DataIsolation] / [Sync]），避免污染 stderr
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  storage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/user-data/sync?key=projects') {
      // 服务器依然返回全部 3 个项目（旧数据未删除）
      return Promise.resolve(new Response(JSON.stringify({ success: true, value: serverProjects }), { status: 200 }));
    }
    if (url === '/api/user-data/sync' && init?.method === 'POST') {
      // 删除提交永远挂起（模拟网络卡死 / 同步失败），不允许任何 POST 成功响应
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

describe('UserManager project deletion tombstone', () => {
  it('does NOT resurrect a deleted project when the cloud sync stalls', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer({
      id: 'project-tombstone-user',
      name: 'project-tombstone-user',
      role: 'user',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    await manager.loadProjectsFromServer(0, 'project-tombstone-user');

    // 删除 project-a + project-b，同步被挂起（无法立即通知服务器）
    await manager.deleteProjects(['project-a', 'project-b']);

    // 此时本地已被乐观删除
    expect(manager.getProjects().map(p => p.id)).toEqual(['project-c']);

    // ★ 关键场景：删除后立即再次从服务器加载（模拟刷新/重新打开应用）
    await manager.loadProjectsFromServer(0, 'project-tombstone-user');

    // ★ 墓碑机制应阻止已删除的项目从服务器端被合并回来
    expect(manager.getProjects().map(p => p.id)).toEqual(['project-c']);
  });
});
