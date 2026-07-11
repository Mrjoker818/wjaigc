import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getApiProvider: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/server-api-config', () => ({
  getApiProvider: mocks.getApiProvider,
  normalizeApiBaseUrl: (value: string) => value,
}));

import { POST as testConnection } from '@/app/api/test-provider-connection/route';
import { POST as verifyProtocol } from '@/app/api/verify-protocol/route';

function request(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 'provider-private' }),
  });
}

describe('provider diagnostic endpoints', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockReset();
    mocks.getApiProvider.mockReset();
  });

  it('rejects a non-admin connection test before reading provider credentials', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await testConnection(request('http://localhost/api/test-provider-connection'));

    expect(response.status).toBe(403);
    expect(mocks.getApiProvider).not.toHaveBeenCalled();
  });

  it('rejects a non-admin protocol verification before reading provider credentials', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await verifyProtocol(request('http://localhost/api/verify-protocol'));

    expect(response.status).toBe(403);
    expect(mocks.getApiProvider).not.toHaveBeenCalled();
  });
});
