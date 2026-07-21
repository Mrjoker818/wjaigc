import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  class AuthConfigurationError extends Error {}

  return {
    AuthConfigurationError,
    authenticateUser: vi.fn(),
    createSessionToken: vi.fn(),
    ensureUserDataDirs: vi.fn(),
  };
});

vi.mock('@/lib/server-auth', () => ({
  AuthConfigurationError: mocks.AuthConfigurationError,
  authenticateUser: mocks.authenticateUser,
  createSessionToken: mocks.createSessionToken,
  WUJIE_SESSION_COOKIE: 'wujie_session',
  WUJIE_SESSION_TTL_SECONDS: 60,
}));
vi.mock('@/lib/server-user-storage', () => ({ ensureUserDataDirs: mocks.ensureUserDataDirs }));

import { POST } from '@/app/api/auth/login/route';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'admin', password: 'password' }),
  });
}

describe('POST /api/auth/login configuration failures', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(value => {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    });
  });

  it('redirects form logins to the public deployment origin instead of the internal server URL', async () => {
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://workspace.example.test');
    mocks.authenticateUser.mockResolvedValue({ id: 'user-1', name: 'admin' });
    mocks.createSessionToken.mockResolvedValue('session-token');
    mocks.ensureUserDataDirs.mockResolvedValue(undefined);

    const response = await POST(new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        name: 'admin',
        password: 'password',
        productType: 'canvas',
        next: '/',
      }),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://workspace.example.test/');
    expect(response.cookies.get('wujie_session')?.value).toBe('session-token');
    vi.unstubAllEnvs();
  });

  it('returns 503 instead of treating a missing production secret as invalid credentials', async () => {
    mocks.authenticateUser.mockRejectedValue(new mocks.AuthConfigurationError('Production authentication secret is not configured'));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Production authentication secret is not configured',
    });
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
  });
});
