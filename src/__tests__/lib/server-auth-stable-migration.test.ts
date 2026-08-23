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
}));

vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => false }));
vi.mock('@/lib/db-storage', () => mocks);
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: vi.fn() }));

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
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const actualWriteFile = actualFs.writeFile;
    vi.doMock('fs/promises', () => ({
      ...actualFs,
      writeFile: async (...args: Parameters<typeof actualWriteFile>) => {
        if (String(args[0]) === usersPath) {
          throw new Error('synthetic sidecar persistence failure');
        }
        return await actualWriteFile(...args);
      },
    }));
    vi.resetModules();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { authenticateUser } = await loadServerAuth();

    await expect(authenticateUser({
      name: 'contract-user',
      password: 'legacy-contract-password',
      productType: 'canvas',
    })).resolves.toMatchObject({ id: 'user-contract-1' });
    expect(warning.mock.calls).toEqual([
      [expect.objectContaining({
        code: 'AUTH_CREDENTIAL_MIGRATION_DEFERRED',
        userId: 'user-contract-1',
      })],
    ]);
    const emittedAuthenticationLogs = JSON.stringify([
      ...warning.mock.calls,
      ...log.mock.calls,
    ]);
    expect(emittedAuthenticationLogs).not.toContain(legacySecret);
    expect(emittedAuthenticationLogs).not.toContain(originalLegacyHash);
    expect(emittedAuthenticationLogs).not.toContain('contract-user');
    expect(emittedAuthenticationLogs).not.toContain('legacy-contract-password');
    expect(emittedAuthenticationLogs).not.toContain('Auto-migrated password hash');
  });

  it('allows administrator recovery only for the exact configured bootstrap password', async () => {
    await createFixture([], false);
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
  });
});
