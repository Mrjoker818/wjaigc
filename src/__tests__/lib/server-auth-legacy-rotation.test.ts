import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  dbGetSystemSetting: vi.fn(),
  dbSetSystemSetting: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
vi.mock('@/lib/db-storage', () => ({
  dbGetSystemSetting: mocks.dbGetSystemSetting,
  dbSetSystemSetting: mocks.dbSetSystemSetting,
  dbReadUsers: vi.fn(),
  dbWriteUsers: vi.fn(),
  dbDeleteUser: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbInitCredits: vi.fn(),
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: vi.fn() }));

const originalEnvironment = { ...process.env };
const legacyStableSecret = 'wujie-ai-stable-auth-secret-fallback-2024';

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  vi.resetModules();
  vi.clearAllMocks();
});

describe('production legacy authentication secret rotation', () => {
  it('replaces a persisted public legacy secret before signing a session', async () => {
    process.env.COZE_PROJECT_ENV = 'PROD';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.dbGetSystemSetting.mockResolvedValue(legacyStableSecret);
    mocks.dbSetSystemSetting.mockResolvedValue(undefined);

    const { createSessionToken, getAuthSecretForInternalRequests } = await import('@/lib/server-auth');
    await expect(createSessionToken({
      id: 'admin-1',
      name: 'admin',
      role: 'admin',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    })).resolves.toMatch(/^[^.]+\.[^.]+$/);

    expect(mocks.dbSetSystemSetting).toHaveBeenCalledTimes(1);
    expect(mocks.dbSetSystemSetting).toHaveBeenCalledWith(
      'auth_secret',
      expect.stringMatching(/^.{32,}$/),
    );
    const rotatedSecret = mocks.dbSetSystemSetting.mock.calls[0]?.[1];
    expect(rotatedSecret).not.toBe(legacyStableSecret);
    await expect(getAuthSecretForInternalRequests()).resolves.toBe(rotatedSecret);
  });
});
