import crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthServiceError } from '@/lib/auth/auth-errors';
import { deriveAuthSecretKid } from '@/lib/auth/auth-secret-ring';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  resolveDatabaseSecretRing: vi.fn(),
  writeAuthJsonFileAtomic: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, readFile: mocks.readFile };
});
vi.mock('@/lib/auth/auth-persistence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/auth-persistence')>(
    '@/lib/auth/auth-persistence',
  );
  return { ...actual, writeAuthJsonFileAtomic: mocks.writeAuthJsonFileAtomic };
});
vi.mock('@/lib/db-storage', () => ({
  dbDeleteUser: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbInitCredits: vi.fn(),
  dbReadUsers: vi.fn(),
  dbWriteUsers: vi.fn(),
}));
vi.mock('@/lib/auth/auth-repository', () => ({
  countLegacyCredentialUsers: vi.fn(),
  resolveDatabaseSecretRing: mocks.resolveDatabaseSecretRing,
  updateUserCredentialSidecar: vi.fn(),
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: vi.fn() }));

const originalEnvironment = { ...process.env };
const databaseSecret = 'database-ring-active-secret-0123456789abcdef';

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('database authentication secret resolution', () => {
  it('uses the active database ring secret for sessions and internal requests', async () => {
    process.env.COZE_PROJECT_ENV = 'PROD';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.resolveDatabaseSecretRing.mockResolvedValue({
      version: 1,
      active: {
        kid: deriveAuthSecretKid(databaseSecret),
        secret: databaseSecret,
        activatedAt: 1,
      },
      updatedAt: 1,
    });

    const { createSessionToken, getAuthSecretForInternalRequests } = await import('@/lib/server-auth');
    await expect(createSessionToken({
      id: 'admin-1',
      name: 'admin',
      role: 'admin',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })).resolves.toMatch(/^[^.]+\.[^.]+$/);

    expect(mocks.resolveDatabaseSecretRing).toHaveBeenCalledWith({
      configuredSecret: null,
      now: expect.any(Number),
    });
    await expect(getAuthSecretForInternalRequests()).resolves.toBe(databaseSecret);
  });

  it('does not generate a secret when authoritative database resolution fails', async () => {
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_PLUS_FILE';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.resolveDatabaseSecretRing.mockRejectedValue(new AuthServiceError(
      'AUTH_PERSISTENCE_UNAVAILABLE',
      'synthetic database failure',
      503,
      true,
    ));
    const randomBytes = vi.spyOn(crypto, 'randomBytes');

    const { createSessionToken } = await import('@/lib/server-auth');
    await expect(createSessionToken({
      id: 'admin-1',
      name: 'admin',
      role: 'admin',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })).rejects.toMatchObject({ code: 'AUTH_PERSISTENCE_UNAVAILABLE' });
    expect(randomBytes).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeAuthJsonFileAtomic).not.toHaveBeenCalled();
  });
});
