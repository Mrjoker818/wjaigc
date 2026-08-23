import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

import { deriveAuthSecretKid, parseAuthSecretRing } from '@/lib/auth/auth-secret-ring';
import { verifyScryptCredential } from '@/lib/auth/auth-password';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => false }));
vi.mock('@/lib/db-storage', () => ({
  dbDeleteUser: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbInitCredits: vi.fn(),
  dbReadUsers: vi.fn(),
  dbWriteUsers: vi.fn(),
}));
vi.mock('@/lib/runtime-settings', () => ({
  getRuntimeSettings: vi.fn().mockResolvedValue({ initialCredits: 0 }),
}));

const originalEnvironment = { ...process.env };
// 立即隔离数据库：authSecret() 回退链为 env → DB → 文件，
// 若保留 PGDATABASE_URL/DATABASE_URL，第一个用例会从真实数据库恢复
// auth_secret，导致"无凭据应拒绝"断言失效。测试必须全程无数据库连接。
delete process.env.PGDATABASE_URL;
delete process.env.DATABASE_URL;
let temporaryDataDir: string | null = null;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  vi.doUnmock('fs/promises');
  vi.doUnmock('@/lib/auth/auth-persistence');
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
    })).rejects.toMatchObject({
      code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      httpStatus: 503,
      retryable: true,
    });
  });

  it('single-flights 20 concurrent FILE_ONLY secret creations to one persisted active secret', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    const ringPath = path.join(temporaryDataDir, 'system', 'auth-secret');
    const readStarted = deferred();
    const releaseRead = deferred();
    let secretReads = 0;
    let secretWrites = 0;

    vi.doMock('fs/promises', async importOriginal => {
      const actual = await importOriginal<typeof import('fs/promises')>();
      return {
        ...actual,
        readFile: async (...args: unknown[]) => {
          if (String(args[0]) === ringPath) {
            secretReads += 1;
            readStarted.resolve();
            await releaseRead.promise;
          }
          return Reflect.apply(actual.readFile, actual, args);
        },
      };
    });
    vi.doMock('@/lib/auth/auth-persistence', async importOriginal => {
      const actual = await importOriginal<typeof import('@/lib/auth/auth-persistence')>();
      return {
        ...actual,
        writeAuthJsonFileAtomic: async (filePath: string, value: unknown) => {
          if (filePath === ringPath) secretWrites += 1;
          return actual.writeAuthJsonFileAtomic(filePath, value);
        },
      };
    });
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'FILE_ONLY';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    vi.resetModules();
    const { getAuthSecretForInternalRequests } = await import('@/lib/server-auth');

    const resolutions = Array.from(
      { length: 20 },
      () => getAuthSecretForInternalRequests(),
    );
    await readStarted.promise;
    const readsBeforeRelease = secretReads;
    releaseRead.resolve();
    const secrets = await Promise.all(resolutions);
    const persistedRing = parseAuthSecretRing(JSON.parse(await readFile(ringPath, 'utf8')) as unknown);

    expect(readsBeforeRelease).toBe(1);
    expect(secretWrites).toBe(1);
    expect(new Set(secrets).size).toBe(1);
    expect(persistedRing?.active.secret).toBe(secrets[0]);
    await expect(getAuthSecretForInternalRequests()).resolves.toBe(secrets[0]);
  });

  it('fails closed instead of treating damaged JSON as a legacy file secret', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    const systemDir = path.join(temporaryDataDir, 'system');
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'auth-secret'), '{"version":1', 'utf8');
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
    })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION_UNAVAILABLE' });
  });

  it('rotates a legacy file secret to the configured secret while retaining the legacy active entry', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    const systemDir = path.join(temporaryDataDir, 'system');
    const legacySecret = 'legacy-file-auth-secret-0123456789abcdef';
    const configuredSecret = 'configured-file-auth-secret-0123456789abcd';
    await mkdir(systemDir, { recursive: true });
    await writeFile(path.join(systemDir, 'auth-secret'), legacySecret, 'utf8');
    await writeFile(path.join(systemDir, 'users.json'), JSON.stringify({
      users: [{
        id: 'legacy-rotation-user',
        name: 'legacy-rotation-user',
        passwordHash: createHash('sha256').update(`${legacySecret}:password`).digest('hex'),
      }],
      updatedAt: 1,
    }), 'utf8');
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = configuredSecret;
    delete process.env.NEXTAUTH_SECRET;

    const { getAuthSecretForInternalRequests } = await import('@/lib/server-auth');

    await expect(getAuthSecretForInternalRequests()).resolves.toBe(configuredSecret);
    const ring = parseAuthSecretRing(JSON.parse(
      await readFile(path.join(systemDir, 'auth-secret'), 'utf8'),
    ) as unknown);
    expect(ring?.active.secret).toBe(configuredSecret);
    expect(ring?.previous?.secret).toBe(legacySecret);
  });

  it('blocks a second file-secret rotation while legacy credentials still need the previous entry', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    const systemDir = path.join(temporaryDataDir, 'system');
    const oldestSecret = 'oldest-file-auth-secret-0123456789abcdef';
    const activeSecret = 'active-file-auth-secret-0123456789abcdef0';
    const nextSecret = 'next-file-auth-secret-0123456789abcdefgh';
    const ringPath = path.join(systemDir, 'auth-secret');
    const originalRing = JSON.stringify({
      version: 1,
      active: {
        kid: deriveAuthSecretKid(activeSecret),
        secret: activeSecret,
        activatedAt: 2,
      },
      previous: {
        kid: deriveAuthSecretKid(oldestSecret),
        secret: oldestSecret,
        activatedAt: 1,
        retiredAt: 2,
      },
      updatedAt: 2,
    });
    await mkdir(systemDir, { recursive: true });
    await writeFile(ringPath, originalRing, 'utf8');
    await writeFile(path.join(systemDir, 'users.json'), JSON.stringify({
      users: [{
        id: 'legacy-rotation-user',
        name: 'legacy-rotation-user',
        passwordHash: createHash('sha256').update(`${activeSecret}:password`).digest('hex'),
      }],
      updatedAt: 1,
    }), 'utf8');
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = nextSecret;
    delete process.env.NEXTAUTH_SECRET;

    const { getAuthSecretForInternalRequests } = await import('@/lib/server-auth');

    await expect(getAuthSecretForInternalRequests()).rejects.toMatchObject({
      code: 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS',
      httpStatus: 409,
    });
    await expect(readFile(ringPath, 'utf8')).resolves.toBe(originalRing);
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
    await expect(authenticateUser({
      name: 'Mr.joker',
      password,
      productType: 'canvas',
    })).resolves.toMatchObject({
      id: 'admin_mr_joker',
      name: 'Mr.joker',
      role: 'admin',
    });

    const migratedSecretFile = JSON.parse(
      await readFile(path.join(systemDir, 'auth-secret'), 'utf8'),
    ) as unknown;
    const ring = parseAuthSecretRing(migratedSecretFile);
    expect(ring?.active.secret).toBe(persistedSecret);

    const migratedUsers = JSON.parse(await readFile(usersFile, 'utf8')) as {
      users: Array<{ id: string; passwordHash: string; credentialHash?: string }>;
    };
    const migratedAdmin = migratedUsers.users.find(user => user.id === 'admin_mr_joker');
    expect(migratedAdmin?.passwordHash).toBe(
      createHash('sha256').update(`${persistedSecret}:${password}`).digest('hex'),
    );
    expect(migratedAdmin?.credentialHash).toMatch(/^scrypt-v1\$32768\$8\$1\$/);
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

    const persisted = JSON.parse(
      await readFile(path.join(temporaryDataDir, 'system', 'users.json'), 'utf8'),
    ) as { users: Array<{ name: string; passwordHash: string; credentialHash?: string }> };
    const admin = persisted.users.find(user => user.name === 'bootstrap-admin');
    expect(admin?.passwordHash).toBe(
      createHash('sha256')
        .update('test-production-auth-secret-at-least-32-characters:bootstrap-password')
        .digest('hex'),
    );
    await expect(verifyScryptCredential('bootstrap-password', admin?.credentialHash || ''))
      .resolves.toBe(true);
  });

  it('authorizes a newly created managed user for the canvas product by default', async () => {
    temporaryDataDir = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-test-'));
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_DATA_DIR = temporaryDataDir;
    process.env.WUJIE_AUTH_SECRET = 'test-development-auth-secret-at-least-32-characters';
    process.env.WUJIE_ADMIN_USERNAME = 'bootstrap-admin';
    process.env.WUJIE_ADMIN_PASSWORD = 'bootstrap-password';

    const { authenticateUser, createManagedUser } = await import('@/lib/server-auth');
    const created = await createManagedUser({
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

    const persisted = JSON.parse(
      await readFile(path.join(temporaryDataDir, 'system', 'users.json'), 'utf8'),
    ) as { users: Array<{ id: string; passwordHash: string; credentialHash?: string }> };
    const managedUser = persisted.users.find(user => user.id === created.id);
    expect(managedUser?.passwordHash).toBe(
      createHash('sha256')
        .update('test-development-auth-secret-at-least-32-characters:canvas-user-password')
        .digest('hex'),
    );
    await expect(verifyScryptCredential('canvas-user-password', managedUser?.credentialHash || ''))
      .resolves.toBe(true);
  });
});
