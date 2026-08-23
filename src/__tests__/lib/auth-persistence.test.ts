import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type AuthPersistenceMode = 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';

type AuthPersistenceContract = {
  resolveAuthPersistenceMode(input: {
    databaseConfigured: boolean;
    rawMode?: string;
    production?: boolean;
  }): AuthPersistenceMode;
  readAuthJsonFile<T>(filePath: string): Promise<T | null>;
  writeAuthJsonFileAtomic(filePath: string, value: unknown): Promise<void>;
};

async function loadAuthPersistence(): Promise<AuthPersistenceContract> {
  return await import('@/lib/auth/auth-persistence') as AuthPersistenceContract;
}

let temporaryDirectory: string | null = null;
const originalEnvironment = { ...process.env };

afterEach(async () => {
  vi.doUnmock('@/lib/auth/auth-persistence');
  vi.doUnmock('@/lib/db-client');
  vi.doUnmock('@/lib/db-storage');
  vi.doUnmock('fs/promises');
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
  vi.clearAllMocks();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe('authentication persistence modes', () => {
  it('defaults to the configured authority instead of silently mixing stores', async () => {
    const { resolveAuthPersistenceMode } = await loadAuthPersistence();

    expect(resolveAuthPersistenceMode({ databaseConfigured: true })).toBe('DB_ONLY');
    expect(resolveAuthPersistenceMode({ databaseConfigured: false })).toBe('FILE_ONLY');
  });

  it('honors an explicit DB_PLUS_FILE mode only when requested', async () => {
    const { resolveAuthPersistenceMode } = await loadAuthPersistence();

    expect(resolveAuthPersistenceMode({
      databaseConfigured: true,
      rawMode: 'DB_PLUS_FILE',
    })).toBe('DB_PLUS_FILE');
  });

  it('fails closed for invalid and impossible persistence configurations', async () => {
    const { resolveAuthPersistenceMode } = await loadAuthPersistence();

    expect(() => resolveAuthPersistenceMode({
      databaseConfigured: true,
      rawMode: 'invalid',
    })).toThrow('AUTH_CONFIGURATION_UNAVAILABLE');
    expect(() => resolveAuthPersistenceMode({
      databaseConfigured: false,
      rawMode: 'DB_ONLY',
    })).toThrow('AUTH_CONFIGURATION_UNAVAILABLE');
    expect(() => resolveAuthPersistenceMode({
      databaseConfigured: true,
      rawMode: 'FILE_ONLY',
      production: true,
    })).toThrow('AUTH_CONFIGURATION_UNAVAILABLE');
  });

  it('writes and reads file-only JSON through an atomic persistence boundary', async () => {
    const { readAuthJsonFile, writeAuthJsonFileAtomic } = await loadAuthPersistence();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    const expected = { version: 1, marker: 'contract-only' };

    await writeAuthJsonFileAtomic(targetPath, expected);

    await expect(readAuthJsonFile<typeof expected>(targetPath)).resolves.toEqual(expected);
    await expect(readFile(targetPath, 'utf8')).resolves.toContain('contract-only');
  });

  it('preserves the existing target when rename interrupts an atomic file write', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    const previousContent = JSON.stringify({ marker: 'previous-contract-value' });
    await writeFile(targetPath, previousContent, 'utf8');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const rename = vi.fn(async () => {
      throw new Error('synthetic rename interruption');
    });
    const interruptedFileSystem = { ...actualFs, rename };
    vi.doMock('fs/promises', () => interruptedFileSystem);
    vi.doMock('node:fs/promises', () => interruptedFileSystem);
    vi.resetModules();
    const { writeAuthJsonFileAtomic } = await loadAuthPersistence();

    await expect(writeAuthJsonFileAtomic(targetPath, { marker: 'next-contract-value' })).rejects.toThrow(
      'AUTH_PERSISTENCE_UNAVAILABLE',
    );
    expect(rename).toHaveBeenCalledTimes(1);
    const [temporaryPath, renameTarget] = rename.mock.calls[0] ?? [];
    expect(temporaryPath).not.toBe(targetPath);
    expect(path.dirname(String(temporaryPath))).toBe(temporaryDirectory);
    expect(renameTarget).toBe(targetPath);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(previousContent);
  });

  it('consumes WUJIE_AUTH_PERSISTENCE_MODE from the real server-auth persistence path', async () => {
    const resolveAuthPersistenceMode = vi.fn(() => 'DB_PLUS_FILE' as const);
    vi.doMock('@/lib/auth/auth-persistence', () => ({ resolveAuthPersistenceMode }));
    vi.doMock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
    const activeSecret = 'persistence-wiring-contract-secret-0123456789';
    const password = 'persistence-wiring-contract-password';
    const passwordHash = createHash('sha256').update(`${activeSecret}:${password}`).digest('hex');
    const adminPassword = 'persistence-admin-contract-password';
    const adminPasswordHash = createHash('sha256').update(`${activeSecret}:${adminPassword}`).digest('hex');
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
  });
});
