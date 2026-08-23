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
