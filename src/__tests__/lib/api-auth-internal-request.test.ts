import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAuthSecretForInternalRequests: vi.fn(),
  getDesktopAuth: vi.fn(),
  tokenFromHeader: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
  getAuthSecretForInternalRequests: mocks.getAuthSecretForInternalRequests,
}));
vi.mock('@/lib/desktop-cloud', () => ({
  getDesktopAuth: mocks.getDesktopAuth,
  tokenFromHeader: mocks.tokenFromHeader,
}));

import { getInternalRequestHeaders, getRequestUser } from '@/lib/api-auth';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe('internal request authentication', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.getAuthSecretForInternalRequests.mockResolvedValue('a'.repeat(32));
    mocks.tokenFromHeader.mockReturnValue(null);
    delete process.env.INTERNAL_API_SECRET;
    process.env.WUJIE_AUTH_SECRET = 'a'.repeat(32);
  });

  it('does not trust forgeable internal identity headers without the shared secret', async () => {
    const request = new NextRequest('http://localhost/api/generate', {
      headers: {
        'x-internal-request': 'true',
        'x-internal-user-id': 'admin-1',
        'x-internal-user-role': 'admin',
      },
    });

    await expect(getRequestUser(request)).resolves.toBeNull();
  });

  it('accepts an internal request only when its shared secret matches', async () => {
    const request = new NextRequest('http://localhost/api/generate', {
      headers: {
        'x-internal-request': 'true',
        'x-internal-user-id': 'worker-1',
        'x-internal-user-role': 'admin',
        'x-wujie-internal-secret': 'a'.repeat(32),
      },
    });

    await expect(getRequestUser(request)).resolves.toMatchObject({
      source: 'internal',
      user: { id: 'worker-1', role: 'admin' },
    });
  });

  it('uses the persisted session-auth secret for asynchronous internal requests', async () => {
    delete process.env.INTERNAL_API_SECRET;
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    mocks.getAuthSecretForInternalRequests.mockResolvedValue('p'.repeat(32));

    await expect(getInternalRequestHeaders('worker-2', 'admin')).resolves.toMatchObject({
      'x-internal-request': 'true',
      'x-internal-user-id': 'worker-2',
      'x-wujie-internal-secret': 'p'.repeat(32),
    });

    const request = new NextRequest('http://localhost/api/generate', {
      headers: await getInternalRequestHeaders('worker-2', 'admin'),
    });
    await expect(getRequestUser(request)).resolves.toMatchObject({
      source: 'internal',
      user: { id: 'worker-2', role: 'admin' },
    });
  });
});
