import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { AuthServiceError } from './auth-errors';

export type AuthPersistenceMode = 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';

interface ResolveAuthPersistenceModeInput {
  databaseConfigured: boolean;
  rawMode?: string;
  production?: boolean;
}

function configurationUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_CONFIGURATION_UNAVAILABLE',
    'Authentication persistence configuration is unavailable.',
    503,
    true,
  );
}

function persistenceUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_PERSISTENCE_UNAVAILABLE',
    'Authentication persistence is unavailable.',
    503,
    true,
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

export function resolveAuthPersistenceMode(input: ResolveAuthPersistenceModeInput): AuthPersistenceMode {
  const mode = input.rawMode ?? (input.databaseConfigured ? 'DB_ONLY' : 'FILE_ONLY');

  if (mode !== 'DB_ONLY' && mode !== 'DB_PLUS_FILE' && mode !== 'FILE_ONLY') {
    throw configurationUnavailable();
  }

  if ((mode === 'DB_ONLY' || mode === 'DB_PLUS_FILE') && !input.databaseConfigured) {
    throw configurationUnavailable();
  }

  if (mode === 'FILE_ONLY' && input.databaseConfigured && input.production === true) {
    throw configurationUnavailable();
  }

  return mode;
}

export async function readAuthJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw persistenceUnavailable();
  }
}

const authFileWriteTails = new Map<string, Promise<void>>();

async function withAuthFileWriteLock<T>(filePath: string, work: () => Promise<T>): Promise<T> {
  const previous = authFileWriteTails.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  authFileWriteTails.set(filePath, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (authFileWriteTails.get(filePath) === current) authFileWriteTails.delete(filePath);
  }
}

async function writeAuthJsonFileAtomicUnlocked(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);

  try {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, JSON.stringify(value), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Preserve the original persistence failure if temporary cleanup also fails.
    }
    throw persistenceUnavailable();
  }
}

export async function writeAuthJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await withAuthFileWriteLock(filePath, () => writeAuthJsonFileAtomicUnlocked(filePath, value));
}

export async function refreshAuthJsonFileAtomic<T>(
  filePath: string,
  loadValue: () => Promise<T>,
): Promise<T> {
  return await withAuthFileWriteLock(filePath, async () => {
    const value = await loadValue();
    await writeAuthJsonFileAtomicUnlocked(filePath, value);
    return value;
  });
}
