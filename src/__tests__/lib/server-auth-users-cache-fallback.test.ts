import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

vi.mock('server-only', () => ({}));

// 认证链路依赖数据库用户表；本测试聚焦"数据库 + 本地文件同时临时故障"时
// 会话校验的连续性：readStore 必须降级使用最近一次成功的内存快照，
// 而不是返回空用户列表导致已登录用户被误判为 401 Authentication required。
vi.mock('@/lib/db-client', () => ({
  isDatabaseConfigured: () => true,
}));

const dbReadUsersMock = vi.fn();

vi.mock('@/lib/db-storage', () => ({
  dbReadUsers: (...args: unknown[]) => dbReadUsersMock(...args),
  dbWriteUsers: vi.fn(async () => undefined),
  dbDeleteUser: vi.fn(async () => true),
  dbDeleteUserData: vi.fn(async () => true),
  dbInitCredits: vi.fn(async () => undefined),
  dbGetSystemSetting: vi.fn(async () => null),
}));

const originalEnvironment = { ...process.env };
let temporaryDataDir: string | null = null;

beforeEach(() => {
  dbReadUsersMock.mockReset();
});

afterEach(async () => {
  if (temporaryDataDir) {
    await rm(temporaryDataDir, { recursive: true, force: true });
    temporaryDataDir = null;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  vi.resetModules();
});

describe.sequential('server-auth users snapshot fallback', () => {
  it('keeps last known users when DB and local file reads both fail', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-cache-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-users-cache-fallback-secret-32-chars';
    delete process.env.WUJIE_ADMIN_PASSWORD;
    // 极短 TTL，让第二次读取越过缓存窗口，真实走到"新鲜读取失败"分支
    process.env.WUJIE_USERS_CACHE_TTL_MS = '1';

    const adminRow = {
      id: 'admin_mr_joker',
      name: 'Mr.joker',
      password_hash: 'hashed',
      role: 'admin',
      status: 'active',
      created_at: 1,
      updated_at: 1,
    };
    // 第一次读取：数据库正常返回用户列表
    dbReadUsersMock.mockImplementationOnce(async () => [adminRow]);

    const { listManagedUsers } = await import('@/lib/server-auth');

    const first = await listManagedUsers();
    expect(first.some(user => user.name === 'Mr.joker')).toBe(true);

    // 快照 TTL 过期后，数据库开始持续故障（模拟生产 ETIMEDOUT 抖动），
    // 本地文件也不存在（生产 /tmp 易失场景）
    await new Promise(resolve => setTimeout(resolve, 15));
    dbReadUsersMock.mockImplementation(async () => {
      throw new Error('connect ETIMEDOUT 115.190.227.58:5432');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const second = await listManagedUsers();
      // 修复前：返回空列表 → 会话校验失败 → 401 "Authentication required"
      // 修复后：降级使用最近一次成功的内存快照，已登录用户不受瞬时故障影响
      expect(second.some(user => user.name === 'Mr.joker')).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('refreshes the snapshot after a successful user write', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-cache-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-users-cache-fallback-secret-32-chars';
    delete process.env.WUJIE_ADMIN_PASSWORD;
    process.env.WUJIE_USERS_CACHE_TTL_MS = '1';

    // 初始数据库为空且持续故障 → 首次读取无用户（无 bootstrap 密码，不引导管理员）
    dbReadUsersMock.mockImplementation(async () => {
      throw new Error('connect ETIMEDOUT');
    });

    const { createManagedUser, listManagedUsers } = await import('@/lib/server-auth');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const created = await createManagedUser({ name: 'ops-user', password: 'secret-pass-123' });
      expect(created.name).toBe('ops-user');

      // 写入后立即读取（TTL 已过期）必须看到新用户，而不是旧快照
      const users = await listManagedUsers();
      expect(users.some(user => user.name === 'ops-user')).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
