import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  dbDeleteUser: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbGetSystemSetting: vi.fn().mockResolvedValue(null),
  dbInitCredits: vi.fn(),
  dbReadUsers: vi.fn(),
  dbSetSystemSetting: vi.fn().mockResolvedValue(undefined),
  dbWriteUsers: vi.fn(),
  getRuntimeSettings: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => false }));
vi.mock('@/lib/db-storage', () => mocks);
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: mocks.getRuntimeSettings }));

const originalEnvironment = { ...process.env };
let temporaryDataDirectory: string | null = null;

const activeSecret = 'active-migration-contract-secret-0123456789abcdef';
const legacySecret = 'wujie-ai-stable-auth-secret-fallback-2024';
const adminName = 'admin-contract-user';

function legacyHash(password: string, secret = activeSecret): string {
  return createHash('sha256').update(`${secret}:${password}`).digest('hex');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function databaseUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'db-user-1',
    name: 'db-user-1',
    password_hash: legacyHash('db-user-password'),
    credential_hash: null,
    role: 'user',
    status: 'active',
    product_type: 'canvas,chat',
    api_permissions: { image: true, chat: true },
    storage_folder: 'data/users/db-user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function configureDatabaseMode(mode: 'DB_ONLY' | 'DB_PLUS_FILE' = 'DB_ONLY'): void {
  process.env.COZE_PROJECT_ENV = 'DEV';
  process.env.WUJIE_AUTH_SECRET = activeSecret;
  process.env.WUJIE_ADMIN_USERNAME = adminName;
  process.env.WUJIE_ADMIN_PASSWORD = 'configured-admin-contract-password';
  process.env.WUJIE_AUTH_PERSISTENCE_MODE = mode;
}

async function createFixture(
  users: Record<string, unknown>[],
  includeConfiguredAdmin = true,
): Promise<{ usersPath: string }> {
  temporaryDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-migration-'));
  const systemDirectory = path.join(temporaryDataDirectory, 'system');
  const usersPath = path.join(systemDirectory, 'users.json');
  await mkdir(systemDirectory, { recursive: true });
  const fixtureUsers = includeConfiguredAdmin
    ? [storedUser({
      id: 'admin-contract-1',
      name: adminName,
      passwordHash: legacyHash('configured-admin-contract-password'),
      role: 'admin',
    }), ...users]
    : users;
  await writeFile(usersPath, JSON.stringify({ users: fixtureUsers, updatedAt: 1 }), 'utf8');

  process.env.COZE_PROJECT_ENV = 'DEV';
  process.env.WUJIE_DATA_DIR = temporaryDataDirectory;
  process.env.WUJIE_AUTH_SECRET = activeSecret;
  process.env.WUJIE_ADMIN_USERNAME = adminName;
  process.env.WUJIE_ADMIN_PASSWORD = 'configured-admin-contract-password';
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.PGDATABASE_URL;
  delete process.env.DATABASE_URL;
  mocks.getRuntimeSettings.mockResolvedValue({ initialCredits: 0 });

  return { usersPath };
}

function storedUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-contract-1',
    name: 'contract-user',
    passwordHash: legacyHash('legacy-contract-password'),
    role: 'user',
    status: 'active',
    productType: 'canvas,chat',
    apiPermissions: { image: true, chat: true },
    storageFolder: 'data/users/user-contract-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function loadServerAuth(): Promise<typeof import('@/lib/server-auth')> {
  return await import('@/lib/server-auth');
}

afterEach(async () => {
  vi.doUnmock('fs/promises');
  vi.doUnmock('@/lib/auth/auth-persistence');
  vi.doUnmock('@/lib/auth/auth-repository');
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
  if (temporaryDataDirectory) {
    await rm(temporaryDataDirectory, { recursive: true, force: true });
    temporaryDataDirectory = null;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe.sequential('stable-compatible authentication credential migration', () => {
  it('does not fall back to password_hash when a valid sidecar rejects the supplied password', async () => {
    const { createScryptCredential } = await import('@/lib/auth/auth-password');
    const sidecar = await createScryptCredential('sidecar-only-contract-password');
    await createFixture([storedUser({ credentialHash: sidecar })]);
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'contract-user',
      password: 'legacy-contract-password',
      productType: 'canvas',
    })).resolves.toBeNull();
  });

  it('fails closed when a defined sidecar has an invalid format', async () => {
    await createFixture([storedUser({ credentialHash: 'malformed-sidecar' })]);
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'contract-user',
      password: 'legacy-contract-password',
      productType: 'canvas',
    })).rejects.toMatchObject({
      code: 'AUTH_CREDENTIAL_FORMAT_INVALID',
      httpStatus: 503,
      retryable: false,
    });
  });

  it('rejects every incorrect eight-character password without changing stored credentials', async () => {
    const { usersPath } = await createFixture([storedUser()]);
    const before = await readFile(usersPath, 'utf8');
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'contract-user',
      password: 'badpass8',
      productType: 'canvas',
    })).resolves.toBeNull();
    await expect(readFile(usersPath, 'utf8')).resolves.toBe(before);
  });

  it('writes only a scrypt sidecar after a correct legacy login and preserves password_hash bytes', async () => {
    const { usersPath } = await createFixture([storedUser()]);
    const originalPasswordHash = legacyHash('legacy-contract-password');
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'contract-user',
      password: 'legacy-contract-password',
      productType: 'canvas',
    })).resolves.toMatchObject({ id: 'user-contract-1' });

    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{ id: string; passwordHash: string; credentialHash?: string }>;
    };
    const migratedUser = persisted.users.find(user => user.id === 'user-contract-1');
    expect(migratedUser).toMatchObject({ passwordHash: originalPasswordHash });
    expect(migratedUser?.credentialHash).toMatch(/^scrypt-v1\$32768\$8\$1\$/);
  });

  it('permits a verified legacy login when sidecar migration is deferred and logs only the stable code', async () => {
    const originalLegacyHash = legacyHash('legacy-contract-password', legacySecret);
    const { usersPath } = await createFixture([storedUser({
      passwordHash: originalLegacyHash,
    })]);
    vi.doMock('@/lib/auth/auth-persistence', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
        '@/lib/auth/auth-persistence',
      );
      return {
        ...actual,
        writeAuthJsonFileAtomic: async (filePath: string, value: unknown): Promise<void> => {
          if (filePath === usersPath) {
            throw new Error('synthetic sidecar persistence failure');
          }
          return await actual.writeAuthJsonFileAtomic(filePath, value);
        },
      };
    });
    vi.resetModules();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'contract-user',
      password: 'legacy-contract-password',
      productType: 'canvas',
    })).resolves.toMatchObject({ id: 'user-contract-1' });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls).toEqual([[
      {
        code: 'AUTH_CREDENTIAL_MIGRATION_DEFERRED',
        userId: 'user-contract-1',
      },
    ]]);
    const emittedAuthenticationLogs = JSON.stringify([
      ...warning.mock.calls,
      ...log.mock.calls,
    ]);
    expect(emittedAuthenticationLogs).not.toContain(activeSecret);
    expect(emittedAuthenticationLogs).not.toContain(legacySecret);
    expect(emittedAuthenticationLogs).not.toContain(originalLegacyHash);
    expect(emittedAuthenticationLogs).not.toContain('contract-user');
    expect(emittedAuthenticationLogs).not.toContain('legacy-contract-password');
    expect(emittedAuthenticationLogs).not.toContain('Auto-migrated password hash');
  });

  it('allows administrator recovery only for the exact configured bootstrap password', async () => {
    const { usersPath } = await createFixture([storedUser({
      id: 'admin-contract-1',
      name: adminName,
      passwordHash: legacyHash('obsolete-admin-password'),
      role: 'user',
    })], false);
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: adminName,
      password: 'badpass8',
      productType: 'canvas',
    })).resolves.toBeNull();
    await expect(authenticateUser({
      name: adminName,
      password: 'configured-admin-contract-password',
      productType: 'canvas',
    })).resolves.toMatchObject({ name: adminName, role: 'admin' });

    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{ name: string; passwordHash: string; credentialHash?: string }>;
    };
    const recoveredAdmin = persisted.users.find(user => user.name === adminName);
    expect(recoveredAdmin?.passwordHash).toBe(legacyHash('configured-admin-contract-password'));
    expect(recoveredAdmin?.credentialHash).toMatch(/^scrypt-v1\$32768\$8\$1\$/);
  });

  it('writes both stable and scrypt credentials for a newly managed user', async () => {
    const { usersPath } = await createFixture([]);
    const { createManagedUser } = await loadServerAuth();

    const created = await createManagedUser({
      name: 'new-contract-user',
      password: 'new-contract-password',
    });
    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{ id: string; passwordHash: string; credentialHash?: string }>;
    };
    const stored = persisted.users.find(user => user.id === created.id);
    expect(stored?.passwordHash).toBe(legacyHash('new-contract-password'));
    expect(stored?.credentialHash).toMatch(/^scrypt-v1\$32768\$8\$1\$/);
  });

  it('preserves both credentials during an ordinary managed-user update', async () => {
    const { createScryptCredential } = await import('@/lib/auth/auth-password');
    const credentialHash = await createScryptCredential('legacy-contract-password');
    const { usersPath } = await createFixture([storedUser({ credentialHash })]);
    const { updateManagedUser } = await loadServerAuth();

    await expect(updateManagedUser('user-contract-1', {
      email: 'updated@example.com',
    })).resolves.toMatchObject({ email: 'updated@example.com' });
    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{ id: string; passwordHash: string; credentialHash?: string }>;
    };
    const stored = persisted.users.find(user => user.id === 'user-contract-1');
    expect(stored).toMatchObject({
      passwordHash: legacyHash('legacy-contract-password'),
      credentialHash,
    });
  });

  it('rewrites both credentials during a managed-user password update', async () => {
    const { createScryptCredential, verifyScryptCredential } = await import('@/lib/auth/auth-password');
    const oldCredentialHash = await createScryptCredential('legacy-contract-password');
    const { usersPath } = await createFixture([storedUser({ credentialHash: oldCredentialHash })]);
    const { updateManagedUser } = await loadServerAuth();

    await expect(updateManagedUser('user-contract-1', {
      password: 'replacement-contract-password',
    })).resolves.toMatchObject({ id: 'user-contract-1' });
    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{ id: string; passwordHash: string; credentialHash?: string }>;
    };
    const stored = persisted.users.find(user => user.id === 'user-contract-1');
    expect(stored?.passwordHash).toBe(legacyHash('replacement-contract-password'));
    expect(stored?.credentialHash).not.toBe(oldCredentialHash);
    await expect(verifyScryptCredential(
      'replacement-contract-password',
      stored?.credentialHash || '',
    )).resolves.toBe(true);
  });

  it('consumes WUJIE_AUTH_PERSISTENCE_MODE from the real server-auth persistence path', async () => {
    const resolveAuthPersistenceMode = vi.fn(() => 'DB_PLUS_FILE' as const);
    vi.doMock('@/lib/auth/auth-persistence', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
        '@/lib/auth/auth-persistence',
      );
      return {
        ...actual,
        resolveAuthPersistenceMode,
        writeAuthJsonFileAtomic: vi.fn().mockResolvedValue(undefined),
      };
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    const activeSecret = 'persistence-wiring-contract-secret-0123456789';
    const password = 'persistence-wiring-contract-password';
    const passwordHash = createHash('sha256').update(`${activeSecret}:${password}`).digest('hex');
    const { createScryptCredential } = await import('@/lib/auth/auth-password');
    const credentialHash = await createScryptCredential(password);
    const adminPassword = 'persistence-admin-contract-password';
    const adminPasswordHash = createHash('sha256').update(`${activeSecret}:${adminPassword}`).digest('hex');
    const { deriveAuthSecretKid } = await import('@/lib/auth/auth-secret-ring');
    const resolveDatabaseSecretRing = vi.fn().mockResolvedValue({
      version: 1 as const,
      active: {
        kid: deriveAuthSecretKid(activeSecret),
        secret: activeSecret,
        activatedAt: 1,
      },
      updatedAt: 1,
    });
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing,
      updateUserCredentialSidecar: vi.fn(),
    }));
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbGetSystemSetting: vi.fn().mockResolvedValue(null),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn().mockResolvedValue([{
        id: 'persistence-contract-admin',
        name: 'persistence-contract-admin',
        password_hash: adminPasswordHash,
        role: 'admin',
        status: 'active',
        product_type: 'canvas,chat',
        api_permissions: { image: true, chat: true },
        storage_folder: 'data/users/persistence-contract-admin',
        created_at: 1,
        updated_at: 1,
      }, {
        id: 'persistence-contract-user',
        name: 'persistence-contract-user',
        password_hash: passwordHash,
        credential_hash: credentialHash,
        role: 'user',
        status: 'active',
        product_type: 'canvas,chat',
        api_permissions: { image: true, chat: true },
        storage_folder: 'data/users/persistence-contract-user',
        created_at: 1,
        updated_at: 1,
      }]),
      dbSetSystemSetting: vi.fn().mockResolvedValue(undefined),
      dbWriteUsers: vi.fn().mockResolvedValue(undefined),
    }));
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_SECRET = activeSecret;
    process.env.WUJIE_ADMIN_USERNAME = 'persistence-contract-admin';
    process.env.WUJIE_ADMIN_PASSWORD = adminPassword;
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_PLUS_FILE';
    vi.resetModules();
    const { authenticateUser } = await import('@/lib/server-auth');

    await expect(authenticateUser({
      name: 'persistence-contract-user',
      password,
      productType: 'canvas',
    })).resolves.toMatchObject({ id: 'persistence-contract-user' });
    expect(resolveAuthPersistenceMode).toHaveBeenCalledWith({
      databaseConfigured: true,
      rawMode: 'DB_PLUS_FILE',
      production: false,
    });
    expect(resolveDatabaseSecretRing).toHaveBeenCalledWith({
      configuredSecret: activeSecret,
      now: expect.any(Number),
    });
  });

  it('maps a null database sidecar to legacy migration and updates only the sidecar column', async () => {
    const { deriveAuthSecretKid } = await import('@/lib/auth/auth-secret-ring');
    const updateUserCredentialSidecar = vi.fn().mockResolvedValue('updated');
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: {
          kid: deriveAuthSecretKid(activeSecret),
          secret: activeSecret,
          activatedAt: 1,
        },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar,
    }));
    const dbWriteUsers = vi.fn().mockResolvedValue(true);
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn().mockResolvedValue([{
        id: 'admin-contract-1',
        name: adminName,
        password_hash: legacyHash('configured-admin-contract-password'),
        credential_hash: null,
        role: 'admin',
        status: 'active',
        product_type: 'canvas,chat',
        api_permissions: { image: true, chat: true },
        storage_folder: 'data/users/admin-contract-1',
        created_at: 1,
        updated_at: 1,
      }, {
        id: 'db-null-sidecar-user',
        name: 'db-null-sidecar-user',
        password_hash: legacyHash('db-null-sidecar-password'),
        credential_hash: null,
        role: 'user',
        status: 'active',
        product_type: 'canvas,chat',
        api_permissions: { image: true, chat: true },
        storage_folder: 'data/users/db-null-sidecar-user',
        created_at: 1,
        updated_at: 1,
      }]),
      dbWriteUsers,
    }));
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_SECRET = activeSecret;
    process.env.WUJIE_ADMIN_USERNAME = adminName;
    process.env.WUJIE_ADMIN_PASSWORD = 'configured-admin-contract-password';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
    vi.resetModules();
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'db-null-sidecar-user',
      password: 'db-null-sidecar-password',
      productType: 'canvas',
    })).resolves.toMatchObject({ id: 'db-null-sidecar-user' });
    expect(updateUserCredentialSidecar).toHaveBeenCalledWith(
      'db-null-sidecar-user',
      expect.stringMatching(/^scrypt-v1\$32768\$8\$1\$/),
    );
    expect(dbWriteUsers).not.toHaveBeenCalled();
  });

  it('preserves a malformed non-null database sidecar and fails closed', async () => {
    const { deriveAuthSecretKid } = await import('@/lib/auth/auth-secret-ring');
    const updateUserCredentialSidecar = vi.fn();
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: {
          kid: deriveAuthSecretKid(activeSecret),
          secret: activeSecret,
          activatedAt: 1,
        },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar,
    }));
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn().mockResolvedValue([{
        id: 'admin-contract-1',
        name: adminName,
        password_hash: legacyHash('configured-admin-contract-password'),
        credential_hash: null,
        role: 'admin',
        status: 'active',
        product_type: 'canvas,chat',
        api_permissions: { image: true, chat: true },
        storage_folder: 'data/users/admin-contract-1',
        created_at: 1,
        updated_at: 1,
      }, {
        id: 'db-malformed-sidecar-user',
        name: 'db-malformed-sidecar-user',
        password_hash: legacyHash('db-malformed-sidecar-password'),
        credential_hash: 'defined-but-malformed',
        role: 'user',
        status: 'active',
        product_type: 'canvas,chat',
        api_permissions: { image: true, chat: true },
        storage_folder: 'data/users/db-malformed-sidecar-user',
        created_at: 1,
        updated_at: 1,
      }]),
      dbWriteUsers: vi.fn().mockResolvedValue(true),
    }));
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_SECRET = activeSecret;
    process.env.WUJIE_ADMIN_USERNAME = adminName;
    process.env.WUJIE_ADMIN_PASSWORD = 'configured-admin-contract-password';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
    vi.resetModules();
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'db-malformed-sidecar-user',
      password: 'db-malformed-sidecar-password',
      productType: 'canvas',
    })).rejects.toMatchObject({ code: 'AUTH_CREDENTIAL_FORMAT_INVALID' });
    expect(updateUserCredentialSidecar).not.toHaveBeenCalled();
  });

  it('rejects an in-memory administrator bootstrap when the empty database cannot be written', async () => {
    const { deriveAuthSecretKid } = await import('@/lib/auth/auth-secret-ring');
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: {
          kid: deriveAuthSecretKid(activeSecret),
          secret: activeSecret,
          activatedAt: 1,
        },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar: vi.fn(),
    }));
    const dbWriteUsers = vi.fn().mockResolvedValue(false);
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn().mockResolvedValue([]),
      dbWriteUsers,
    }));
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_SECRET = activeSecret;
    process.env.WUJIE_ADMIN_USERNAME = adminName;
    process.env.WUJIE_ADMIN_PASSWORD = 'configured-admin-contract-password';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
    vi.resetModules();
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: adminName,
      password: 'configured-admin-contract-password',
      productType: 'canvas',
    })).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      httpStatus: 503,
    });
    expect(dbWriteUsers).toHaveBeenCalledTimes(1);
  });
});

describe.sequential('concurrency-safe authentication persistence', () => {
  it('serializes FILE_ONLY profile and password writes and merges after the lock is acquired', async () => {
    const { createScryptCredential, verifyScryptCredential } = await import('@/lib/auth/auth-password');
    const oldCredentialHash = await createScryptCredential('legacy-contract-password');
    const { usersPath } = await createFixture([storedUser({ credentialHash: oldCredentialHash })]);
    const firstWriteStarted = deferred();
    const releaseFirstWrite = deferred();
    const secondWriteFinished = deferred();
    let userWriteCount = 0;
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => false }));
    vi.doMock('@/lib/db-storage', () => mocks);
    vi.doMock('@/lib/auth/auth-persistence', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
        '@/lib/auth/auth-persistence',
      );
      return {
        ...actual,
        writeAuthJsonFileAtomic: async (filePath: string, value: unknown): Promise<void> => {
          if (filePath === usersPath) {
            userWriteCount += 1;
            if (userWriteCount === 1) {
              firstWriteStarted.resolve();
              await releaseFirstWrite.promise;
            }
          }
          await actual.writeAuthJsonFileAtomic(filePath, value);
          if (filePath === usersPath && userWriteCount === 2) secondWriteFinished.resolve();
        },
      };
    });
    vi.resetModules();
    const { updateManagedUser } = await loadServerAuth();

    const profileUpdate = updateManagedUser('user-contract-1', {
      email: 'concurrent-profile@example.test',
    });
    await firstWriteStarted.promise;
    const passwordUpdate = updateManagedUser('user-contract-1', {
      password: 'concurrent-replacement-password',
    });
    const secondEscapedLock = await Promise.race([
      secondWriteFinished.promise.then(() => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), 750)),
    ]);
    releaseFirstWrite.resolve();

    await expect(Promise.all([profileUpdate, passwordUpdate])).resolves.toHaveLength(2);
    expect(secondEscapedLock).toBe(false);
    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{
        id: string;
        email?: string;
        passwordHash: string;
        credentialHash?: string;
      }>;
    };
    const stored = persisted.users.find(user => user.id === 'user-contract-1');
    expect(stored?.email).toBe('concurrent-profile@example.test');
    expect(stored?.passwordHash).toBe(legacyHash('concurrent-replacement-password'));
    await expect(verifyScryptCredential(
      'concurrent-replacement-password',
      stored?.credentialHash || '',
    )).resolves.toBe(true);
  });

  it('does not let a delayed FILE_ONLY legacy migration restore credentials after a password change', async () => {
    const { usersPath } = await createFixture([storedUser()]);
    const actualPassword = await vi.importActual<typeof import('@/lib/auth/auth-password')>(
      '@/lib/auth/auth-password',
    );
    const migrationHashStarted = deferred();
    const releaseMigrationHash = deferred();
    let createCalls = 0;
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => false }));
    vi.doMock('@/lib/db-storage', () => mocks);
    vi.doMock('@/lib/auth/auth-password', async () => ({
      ...actualPassword,
      createScryptCredential: async (password: string): Promise<string> => {
        createCalls += 1;
        if (createCalls === 1) {
          migrationHashStarted.resolve();
          await releaseMigrationHash.promise;
        }
        return await actualPassword.createScryptCredential(password);
      },
    }));
    vi.resetModules();
    const { authenticateUser, updateManagedUser } = await loadServerAuth();

    const login = authenticateUser({
      name: 'contract-user',
      password: 'legacy-contract-password',
      productType: 'canvas',
    });
    await migrationHashStarted.promise;
    await expect(updateManagedUser('user-contract-1', {
      password: 'migration-race-replacement-password',
    })).resolves.toMatchObject({ id: 'user-contract-1' });
    releaseMigrationHash.resolve();
    await expect(login).resolves.toMatchObject({ id: 'user-contract-1' });

    const persisted = JSON.parse(await readFile(usersPath, 'utf8')) as {
      users: Array<{ id: string; passwordHash: string; credentialHash?: string }>;
    };
    const stored = persisted.users.find(user => user.id === 'user-contract-1');
    expect(stored?.passwordHash).toBe(legacyHash('migration-race-replacement-password'));
    await expect(actualPassword.verifyScryptCredential(
      'migration-race-replacement-password',
      stored?.credentialHash || '',
    )).resolves.toBe(true);
  });

  it('retries a DB profile CAS after a concurrent atomic dual-credential password update', async () => {
    const { createScryptCredential, verifyScryptCredential } = await import('@/lib/auth/auth-password');
    const oldCredentialHash = await createScryptCredential('db-user-password');
    let row = databaseUser({ credential_hash: oldCredentialHash });
    const profileWriteStarted = deferred();
    const releaseProfileWrite = deferred();
    let profileCalls = 0;
    const updateUserProfileFields = vi.fn(async (input: {
      expectedUpdatedAt: number;
      updatedAt: number;
      profile: { email: string | null };
    }) => {
      profileCalls += 1;
      if (profileCalls === 1) {
        profileWriteStarted.resolve();
        await releaseProfileWrite.promise;
      }
      if (row.updated_at !== input.expectedUpdatedAt) return 'conflict' as const;
      row = { ...row, email: input.profile.email, updated_at: input.updatedAt };
      return 'updated' as const;
    });
    const updateUserCredentials = vi.fn(async (input: {
      expectedUpdatedAt: number;
      expectedPasswordHash: string;
      passwordHash: string;
      credentialHash: string;
      updatedAt: number;
      profile: { email: string | null };
    }) => {
      if (row.updated_at !== input.expectedUpdatedAt
        || row.password_hash !== input.expectedPasswordHash) return 'conflict' as const;
      row = {
        ...row,
        email: input.profile.email,
        password_hash: input.passwordHash,
        credential_hash: input.credentialHash,
        updated_at: input.updatedAt,
      };
      return 'updated' as const;
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: { kid: 'active-kid', secret: activeSecret, activatedAt: 1 },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar: vi.fn(),
      updateUserCredentials,
      updateUserProfileFields,
    }));
    const dbReadUsers = vi.fn(async () => [
      databaseUser({ id: 'db-admin', name: adminName, role: 'admin' }),
      { ...row },
    ]);
    const dbWriteUsers = vi.fn().mockResolvedValue(false);
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers,
      dbWriteUsers,
    }));
    configureDatabaseMode();
    vi.resetModules();
    const { updateManagedUser } = await loadServerAuth();

    const profileUpdate = updateManagedUser('db-user-1', {
      email: 'db-concurrent-profile@example.test',
    });
    await profileWriteStarted.promise;
    await expect(updateManagedUser('db-user-1', {
      password: 'db-concurrent-replacement-password',
    })).resolves.toMatchObject({ id: 'db-user-1' });
    releaseProfileWrite.resolve();
    await expect(profileUpdate).resolves.toMatchObject({
      email: 'db-concurrent-profile@example.test',
    });

    expect(updateUserProfileFields).toHaveBeenCalledTimes(2);
    expect(updateUserProfileFields.mock.calls.every(([input]) => (
      !('passwordHash' in input) && !('credentialHash' in input)
    ))).toBe(true);
    expect(updateUserCredentials).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'db-user-1',
      expectedPasswordHash: legacyHash('db-user-password'),
      passwordHash: legacyHash('db-concurrent-replacement-password'),
      credentialHash: expect.stringMatching(/^scrypt-v1\$32768\$8\$1\$/),
    }));
    expect(dbWriteUsers).not.toHaveBeenCalled();
    expect(row.email).toBe('db-concurrent-profile@example.test');
    expect(row.password_hash).toBe(legacyHash('db-concurrent-replacement-password'));
    await expect(verifyScryptCredential(
      'db-concurrent-replacement-password',
      String(row.credential_hash),
    )).resolves.toBe(true);
  });

  it('keeps consecutive DB profile and password CAS versions safe when rows contain OID20 strings', async () => {
    const initialUpdatedAt = 1_724_601_600_000;
    let row = databaseUser({
      created_at: '1724601599000',
      updated_at: String(initialUpdatedAt),
    });
    const expectedVersions: number[] = [];
    const writtenVersions: number[] = [];
    const updateUserProfileFields = vi.fn(async (input: {
      expectedUpdatedAt: number;
      updatedAt: number;
      profile: { email: string | null };
    }) => {
      expectedVersions.push(input.expectedUpdatedAt);
      writtenVersions.push(input.updatedAt);
      if (Number(row.updated_at) !== input.expectedUpdatedAt) return 'conflict' as const;
      row = { ...row, email: input.profile.email, updated_at: String(input.updatedAt) };
      return 'updated' as const;
    });
    const updateUserCredentials = vi.fn(async (input: {
      expectedUpdatedAt: number;
      expectedPasswordHash: string;
      passwordHash: string;
      credentialHash: string;
      updatedAt: number;
      profile: { email: string | null };
    }) => {
      expectedVersions.push(input.expectedUpdatedAt);
      writtenVersions.push(input.updatedAt);
      if (Number(row.updated_at) !== input.expectedUpdatedAt
        || row.password_hash !== input.expectedPasswordHash) return 'conflict' as const;
      row = {
        ...row,
        email: input.profile.email,
        password_hash: input.passwordHash,
        credential_hash: input.credentialHash,
        updated_at: String(input.updatedAt),
      };
      return 'updated' as const;
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: { kid: 'active-kid', secret: activeSecret, activatedAt: 1 },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar: vi.fn(),
      updateUserCredentials,
      updateUserProfileFields,
    }));
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn(async () => {
        expect(typeof row.updated_at).toBe('string');
        return [
          databaseUser({ id: 'db-admin', name: adminName, role: 'admin' }),
          {
            ...row,
            created_at: Number(row.created_at),
            updated_at: Number(row.updated_at),
          },
        ];
      }),
      dbWriteUsers: vi.fn(),
    }));
    configureDatabaseMode();
    vi.resetModules();
    const { updateManagedUser } = await loadServerAuth();

    await expect(updateManagedUser('db-user-1', {
      email: 'first-profile@example.test',
    })).resolves.toMatchObject({ email: 'first-profile@example.test' });
    await expect(updateManagedUser('db-user-1', {
      password: 'next-db-password',
    })).resolves.toMatchObject({ id: 'db-user-1' });
    await expect(updateManagedUser('db-user-1', {
      email: 'second-profile@example.test',
    })).resolves.toMatchObject({ email: 'second-profile@example.test' });

    expect(expectedVersions[0]).toBe(initialUpdatedAt);
    expect(expectedVersions.slice(1)).toEqual(writtenVersions.slice(0, -1));
    expect(writtenVersions).toHaveLength(3);
    expect(writtenVersions.every(value => Number.isSafeInteger(value))).toBe(true);
    expect(writtenVersions.every(value => value > initialUpdatedAt)).toBe(true);
    expect(String(row.updated_at)).toBe(String(writtenVersions.at(-1)));
  });

  it('keeps a DB password update when a delayed sidecar migration returns already-set', async () => {
    let row = databaseUser();
    const migrationStarted = deferred();
    const releaseMigration = deferred();
    let migrationStatus: string | null = null;
    const updateUserCredentialSidecar = vi.fn(async (_userId: string, credentialHash: string) => {
      migrationStarted.resolve();
      await releaseMigration.promise;
      if (row.credential_hash !== null) {
        migrationStatus = 'already-set';
        return 'already-set' as const;
      }
      row = { ...row, credential_hash: credentialHash, updated_at: Number(row.updated_at) + 1 };
      migrationStatus = 'updated';
      return 'updated' as const;
    });
    const updateUserCredentials = vi.fn(async (input: {
      passwordHash: string;
      credentialHash: string;
      updatedAt: number;
      profile: { email: string | null };
    }) => {
      row = {
        ...row,
        email: input.profile.email,
        password_hash: input.passwordHash,
        credential_hash: input.credentialHash,
        updated_at: input.updatedAt,
      };
      return 'updated' as const;
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: { kid: 'active-kid', secret: activeSecret, activatedAt: 1 },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar,
      updateUserCredentials,
      updateUserProfileFields: vi.fn(),
    }));
    const dbWriteUsers = vi.fn(async (users: Array<{
      id: string;
      passwordHash: string;
      credentialHash?: string;
      updatedAt: number;
    }>) => {
      const target = users.find(user => user.id === 'db-user-1');
      if (target) {
        row = {
          ...row,
          password_hash: target.passwordHash,
          credential_hash: target.credentialHash ?? null,
          updated_at: target.updatedAt,
        };
      }
      return true;
    });
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn(async () => [
        databaseUser({ id: 'db-admin', name: adminName, role: 'admin' }),
        { ...row },
      ]),
      dbWriteUsers,
    }));
    configureDatabaseMode();
    vi.resetModules();
    const { authenticateUser, updateManagedUser } = await loadServerAuth();

    const login = authenticateUser({
      name: 'db-user-1',
      password: 'db-user-password',
      productType: 'canvas',
    });
    await migrationStarted.promise;
    await expect(updateManagedUser('db-user-1', {
      password: 'db-migration-race-replacement',
    })).resolves.toMatchObject({ id: 'db-user-1' });
    releaseMigration.resolve();
    await expect(login).resolves.toMatchObject({ id: 'db-user-1' });

    expect(migrationStatus).toBe('already-set');
    expect(dbWriteUsers).not.toHaveBeenCalled();
    expect(row.password_hash).toBe(legacyHash('db-migration-race-replacement'));
    expect(row.credential_hash).not.toBeNull();
  });

  it('fails DB reads closed without calling either file persistence API', async () => {
    const readAuthJsonFile = vi.fn();
    const writeAuthJsonFileAtomic = vi.fn();
    vi.doMock('@/lib/auth/auth-persistence', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
        '@/lib/auth/auth-persistence',
      );
      return { ...actual, readAuthJsonFile, writeAuthJsonFileAtomic };
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn().mockRejectedValue(new Error('private database endpoint')),
      dbWriteUsers: vi.fn(),
    }));
    configureDatabaseMode();
    vi.resetModules();
    const { listManagedUsers } = await loadServerAuth();

    await expect(listManagedUsers()).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      httpStatus: 503,
    });
    expect(readAuthJsonFile).not.toHaveBeenCalled();
    expect(writeAuthJsonFileAtomic).not.toHaveBeenCalled();
  });

  it('treats a non-true DB user write as an authoritative create failure', async () => {
    const readAuthJsonFile = vi.fn();
    const writeAuthJsonFileAtomic = vi.fn();
    vi.doMock('@/lib/auth/auth-persistence', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
        '@/lib/auth/auth-persistence',
      );
      return { ...actual, readAuthJsonFile, writeAuthJsonFileAtomic };
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn().mockResolvedValue({
        version: 1,
        active: { kid: 'active-kid', secret: activeSecret, activatedAt: 1 },
        updatedAt: 1,
      }),
      updateUserCredentialSidecar: vi.fn(),
      updateUserCredentials: vi.fn(),
      updateUserProfileFields: vi.fn(),
    }));
    const dbWriteUsers = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn().mockResolvedValue([
        databaseUser({ id: 'db-admin', name: adminName, role: 'admin' }),
      ]),
      dbWriteUsers,
    }));
    configureDatabaseMode();
    vi.resetModules();
    const { createManagedUser } = await loadServerAuth();

    await expect(createManagedUser({
      name: 'db-create-failure-user',
      password: 'db-create-failure-password',
    })).rejects.toMatchObject({ code: 'AUTH_PERSISTENCE_UNAVAILABLE' });
    expect(dbWriteUsers).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'db-create-failure-user',
        passwordHash: legacyHash('db-create-failure-password'),
        credentialHash: expect.stringMatching(/^scrypt-v1\$32768\$8\$1\$/),
      }),
    ]);
    expect(readAuthJsonFile).not.toHaveBeenCalled();
    expect(writeAuthJsonFileAtomic).not.toHaveBeenCalled();
  });

  it('warns once with a sanitized object when DB_PLUS_FILE user replica writes fail', async () => {
    let row = databaseUser({ credential_hash: 'scrypt-v1$32768$8$1$AQEBAQEBAQEBAQEBAQEBAQ$AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' });
    const writeAuthJsonFileAtomic = vi.fn(async (filePath: string): Promise<void> => {
      if (filePath.endsWith('users.json')) throw new Error('replica contains private values');
    });
    vi.doMock('@/lib/auth/auth-persistence', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
        '@/lib/auth/auth-persistence',
      );
      return { ...actual, writeAuthJsonFileAtomic };
    });
    const updateUserProfileFields = vi.fn(async (input: {
      updatedAt: number;
      profile: { email: string | null };
    }) => {
      row = { ...row, email: input.profile.email, updated_at: input.updatedAt };
      return 'updated' as const;
    });
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    vi.doMock('@/lib/auth/auth-repository', () => ({
      countLegacyCredentialUsers: vi.fn(),
      resolveDatabaseSecretRing: vi.fn(),
      updateUserCredentialSidecar: vi.fn(),
      updateUserCredentials: vi.fn(),
      updateUserProfileFields,
    }));
    vi.doMock('@/lib/db-storage', () => ({
      dbDeleteUser: vi.fn(),
      dbDeleteUserData: vi.fn(),
      dbInitCredits: vi.fn(),
      dbReadUsers: vi.fn(async () => [
        databaseUser({ id: 'db-admin', name: adminName, role: 'admin' }),
        { ...row },
      ]),
      dbWriteUsers: vi.fn(),
    }));
    configureDatabaseMode('DB_PLUS_FILE');
    vi.resetModules();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { updateManagedUser } = await loadServerAuth();

    await expect(updateManagedUser('db-user-1', {
      email: 'first-replica-failure@example.test',
    })).resolves.toMatchObject({ email: 'first-replica-failure@example.test' });
    await expect(updateManagedUser('db-user-1', {
      email: 'second-replica-failure@example.test',
    })).resolves.toMatchObject({ email: 'second-replica-failure@example.test' });

    expect(warning.mock.calls).toEqual([[{
      code: 'AUTH_USER_STORE_FILE_REPLICA_DEFERRED',
    }]]);
    const emitted = JSON.stringify(warning.mock.calls);
    expect(emitted).not.toContain('db-user-1');
    expect(emitted).not.toContain('replica contains private values');
    expect(emitted).not.toContain(activeSecret);
    expect(emitted).not.toContain('scrypt-v1');
    expect(updateUserProfileFields).toHaveBeenCalledTimes(2);
  });
});
