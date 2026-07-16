import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getDesktopAuth: vi.fn(),
  tokenFromHeader: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/desktop-cloud', () => ({
  getDesktopAuth: mocks.getDesktopAuth,
  tokenFromHeader: mocks.tokenFromHeader,
}));

import { getRequestUser } from '@/lib/api-auth';

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
});
