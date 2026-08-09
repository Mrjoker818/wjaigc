import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

vi.mock('server-only', () => ({}));

const originalEnvironment = { ...process.env };
// 立即隔离数据库：authSecret() 回退链为 env → DB → 文件，
// 若保留 PGDATABASE_URL/DATABASE_URL，第一个用例会从真实数据库恢复
// auth_secret，导致"无凭据应拒绝"断言失效。测试必须全程无数据库连接。
delete process.env.PGDATABASE_URL;
delete process.env.DATABASE_URL;
let temporaryDataDir: string | null = null;

afterEach(async () => {
  if (temporaryDataDir) {
    await rm(temporaryDataDir, { recursive: true, force: true });
    temporaryDataDir = null;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  // 隔离数据库：authSecret() 的回退链是 env → DB → 文件，
  // 若保留 PGDATABASE_URL/DATABASE_URL 会从真实数据库恢复 auth_secret，
  // 使"无凭据应拒绝"的生产安全断言失效。这些用例必须运行在无数据库连接的环境。
  delete process.env.PGDATABASE_URL;
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

describe.sequential('server authentication production security', () => {
  it('refuses to sign a session when a production authentication secret is missing', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    const { createSessionToken } = await import('@/lib/server-auth');

    await expect(createSessionToken({
      id: 'admin-1',
      name: 'admin',
      role: 'admin',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })).rejects.toThrow('Production authentication secret is not configured');
  });

  it('refuses to bootstrap an administrator without an explicit production password', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-production-auth-secret-at-least-32-characters';
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.WUJIE_ADMIN_PASSWORD;
    process.env.WUJIE_ADMIN_USERNAME = 'bootstrap-admin';

    const { authenticateUser } = await import('@/lib/server-auth');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(authenticateUser({
        name: 'bootstrap-admin',
        password: 'any-value',
      })).rejects.toThrow('Production administrator bootstrap password is not configured');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('authenticates an existing administrator with the persisted production secret after redeploy', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    const systemDir = path.join(temporaryDataDir, 'system');
    const persistedSecret = 'persisted-production-auth-secret-at-least-32-characters';
    const password = 'existing-admin-password';

    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'auth-secret'), persistedSecret, 'utf8');
    const usersFile = path.join(systemDir, 'users.json');
    await writeFile(usersFile, JSON.stringify({
      users: [{
        id: 'admin_mr_joker',
        name: 'Mr.joker',
        passwordHash: createHash('sha256').update(`${persistedSecret}:${password}`).digest('hex'),
        role: 'admin',
        status: 'active',
        productType: 'canvas,chat',
        apiPermissions: { image: true, chat: true },
        storageFolder: 'data/users/admin_mr_joker',
        createdAt: 1,
        updatedAt: 1,
      }],
      updatedAt: 1,
    }), 'utf8');

    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_ADMIN_USERNAME = 'Mr.joker';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.WUJIE_ADMIN_PASSWORD;

    const { authenticateUser } = await import('@/lib/server-auth');
    const usersBeforeLogin = await readFile(usersFile, 'utf8');

    await expect(authenticateUser({
      name: 'Mr.joker',
      password,
      productType: 'canvas',
    })).resolves.toMatchObject({
      id: 'admin_mr_joker',
      name: 'Mr.joker',
      role: 'admin',
    });
    await expect(readFile(usersFile, 'utf8')).resolves.toBe(usersBeforeLogin);
  });

  it('authorizes a newly bootstrapped administrator for the canvas product', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-production-auth-secret-at-least-32-characters';
    process.env.WUJIE_ADMIN_USERNAME = 'bootstrap-admin';
    process.env.WUJIE_ADMIN_PASSWORD = 'bootstrap-password';

    const { authenticateUser } = await import('@/lib/server-auth');

    await expect(authenticateUser({
      name: 'bootstrap-admin',
      password: 'bootstrap-password',
      productType: 'canvas',
    })).resolves.toMatchObject({
      name: 'bootstrap-admin',
      role: 'admin',
      productType: 'canvas,chat',
    });
  });

  it('authorizes a newly created managed user for the canvas product by default', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-development-auth-secret-at-least-32-characters';
    process.env.WUJIE_ADMIN_USERNAME = 'bootstrap-admin';
    process.env.WUJIE_ADMIN_PASSWORD = 'bootstrap-password';

    const { authenticateUser, createManagedUser } = await import('@/lib/server-auth');
    await createManagedUser({
      name: 'canvas-user',
      password: 'canvas-user-password',
    });

    await expect(authenticateUser({
      name: 'canvas-user',
      password: 'canvas-user-password',
      productType: 'canvas',
    })).resolves.toMatchObject({
      name: 'canvas-user',
      role: 'user',
      productType: 'canvas,chat',
    });
  });
});
