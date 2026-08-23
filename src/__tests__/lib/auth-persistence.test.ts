import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
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
});
