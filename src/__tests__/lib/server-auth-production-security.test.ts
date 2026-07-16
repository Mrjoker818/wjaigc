import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

vi.mock('server-only', () => ({}));

const originalEnvironment = { ...process.env };
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
  vi.resetModules();
});

describe.sequential('server authentication production security', () => {
  it('refuses to sign a session when a production authentication secret is missing', async () => {
    process.env.COZE_PROJECT_ENV = 'PROD';
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
});
