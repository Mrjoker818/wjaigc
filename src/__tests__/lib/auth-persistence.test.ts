import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  refreshAuthJsonFileAtomic<T>(filePath: string, loadValue: () => Promise<T>): Promise<T>;
};

async function loadAuthPersistence(): Promise<AuthPersistenceContract> {
  return await import('@/lib/auth/auth-persistence') as AuthPersistenceContract;
}

let temporaryDirectory: string | null = null;
const originalEnvironment = { ...process.env };

afterEach(async () => {
  vi.doUnmock('@/lib/auth/auth-persistence');
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
    })).toThrowError(expect.objectContaining({
      code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      retryable: true,
    }));
    expect(() => resolveAuthPersistenceMode({
      databaseConfigured: false,
      rawMode: 'DB_PLUS_FILE',
    })).toThrowError(expect.objectContaining({ code: 'AUTH_CONFIGURATION_UNAVAILABLE' }));
    expect(() => resolveAuthPersistenceMode({
      databaseConfigured: false,
      rawMode: 'DB_ONLY',
    })).toThrowError(expect.objectContaining({ code: 'AUTH_CONFIGURATION_UNAVAILABLE' }));
    expect(() => resolveAuthPersistenceMode({
      databaseConfigured: true,
      rawMode: 'FILE_ONLY',
      production: true,
    })).toThrowError(expect.objectContaining({ code: 'AUTH_CONFIGURATION_UNAVAILABLE' }));
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

  it('creates a missing parent directory before the first atomic write', async () => {
    const { readAuthJsonFile, writeAuthJsonFileAtomic } = await loadAuthPersistence();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'system', 'auth.json');

    await writeAuthJsonFileAtomic(targetPath, { marker: 'first-replica' });

    await expect(readAuthJsonFile(targetPath)).resolves.toEqual({ marker: 'first-replica' });
  });

  it('serializes a database-backed refresh with direct replica writes', async () => {
    const { readAuthJsonFile, refreshAuthJsonFileAtomic, writeAuthJsonFileAtomic } = await loadAuthPersistence();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'system', 'users.json');
    let releaseSource!: () => void;
    let sourceStarted!: () => void;
    const sourceGate = new Promise<void>(resolve => { releaseSource = resolve; });
    const sourceEntered = new Promise<void>(resolve => { sourceStarted = resolve; });

    const staleRefresh = refreshAuthJsonFileAtomic(targetPath, async () => {
      sourceStarted();
      await sourceGate;
      return { users: [{ id: 'stale-user' }] };
    });
    await sourceEntered;
    const newerWrite = writeAuthJsonFileAtomic(targetPath, { users: [{ id: 'new-user' }] });
    releaseSource();
    await Promise.all([staleRefresh, newerWrite]);

    await expect(readAuthJsonFile(targetPath)).resolves.toEqual({ users: [{ id: 'new-user' }] });
  });

  it('returns null only when the JSON file does not exist', async () => {
    const { readAuthJsonFile } = await loadAuthPersistence();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const missingPath = path.join(temporaryDirectory, 'missing-auth.json');

    await expect(readAuthJsonFile(missingPath)).resolves.toBeNull();
  });

  it('fails closed when persisted JSON is malformed', async () => {
    const { readAuthJsonFile } = await loadAuthPersistence();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    await writeFile(targetPath, '{not valid JSON', 'utf8');

    await expect(readAuthJsonFile(targetPath)).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });
  });

  it('fails closed when reading persisted JSON is denied', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const readFileDenied = vi.fn(async () => {
      const error = Object.assign(new Error('synthetic read denial'), { code: 'EACCES' });
      throw error;
    });
    const deniedFileSystem = { ...actualFs, readFile: readFileDenied };
    vi.doMock('fs/promises', () => deniedFileSystem);
    vi.doMock('node:fs/promises', () => deniedFileSystem);
    vi.resetModules();
    const { readAuthJsonFile } = await loadAuthPersistence();

    await expect(readAuthJsonFile(targetPath)).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });
  });

  it('creates its same-directory temporary file with restrictive permissions', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const writeFileWithPermissions = vi.fn(actualFs.writeFile);
    const permissionedFileSystem = { ...actualFs, writeFile: writeFileWithPermissions };
    vi.doMock('fs/promises', () => permissionedFileSystem);
    vi.doMock('node:fs/promises', () => permissionedFileSystem);
    vi.resetModules();
    const { writeAuthJsonFileAtomic } = await loadAuthPersistence();

    await writeAuthJsonFileAtomic(targetPath, { marker: 'permission-contract-value' });

    expect(writeFileWithPermissions).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${temporaryDirectory.replace(/\\/g, '\\\\')}`)),
      expect.any(String),
      expect.objectContaining({ flag: 'wx', mode: 0o600 }),
    );
  });

  it('preserves the existing target when rename interrupts an atomic file write', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    const previousContent = JSON.stringify({ marker: 'previous-contract-value' });
    await writeFile(targetPath, previousContent, 'utf8');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const rename = vi.fn(async (..._args: Parameters<typeof actualFs.rename>) => {
      throw new Error('synthetic rename interruption');
    });
    const interruptedFileSystem = { ...actualFs, rename };
    vi.doMock('fs/promises', () => interruptedFileSystem);
    vi.doMock('node:fs/promises', () => interruptedFileSystem);
    vi.resetModules();
    const { writeAuthJsonFileAtomic } = await loadAuthPersistence();

    await expect(writeAuthJsonFileAtomic(targetPath, { marker: 'next-contract-value' })).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });
    expect(rename).toHaveBeenCalledTimes(1);
    const [temporaryPath, renameTarget] = rename.mock.calls[0] ?? [];
    expect(temporaryPath).not.toBe(targetPath);
    expect(path.dirname(String(temporaryPath))).toBe(temporaryDirectory);
    expect(renameTarget).toBe(targetPath);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(previousContent);
    await expect(readdir(temporaryDirectory)).resolves.toEqual(['auth.json']);
  });

  it('cleans up its temporary file when writing fails before rename', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-auth-persistence-'));
    const targetPath = path.join(temporaryDirectory, 'auth.json');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const writeFileInterrupted = vi.fn(async (...args: Parameters<typeof actualFs.writeFile>) => {
      await actualFs.writeFile(...args);
      throw new Error('synthetic write interruption');
    });
    const interruptedFileSystem = { ...actualFs, writeFile: writeFileInterrupted };
    vi.doMock('fs/promises', () => interruptedFileSystem);
    vi.doMock('node:fs/promises', () => interruptedFileSystem);
    vi.resetModules();
    const { writeAuthJsonFileAtomic } = await loadAuthPersistence();

    await expect(writeAuthJsonFileAtomic(targetPath, { marker: 'next-contract-value' })).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });
    await expect(readdir(temporaryDirectory)).resolves.toEqual([]);
  });

});
