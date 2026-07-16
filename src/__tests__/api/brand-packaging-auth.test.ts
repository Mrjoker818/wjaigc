import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  findAllProvidersForType: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
  findAllProvidersForType: mocks.findAllProvidersForType,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));

import { POST } from '@/app/api/brand-packaging/generate/route';

describe('POST /api/brand-packaging/generate authorization', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
  });

  it('rejects unauthenticated callers before resolving an image provider', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await POST(new NextRequest('http://localhost/api/brand-packaging/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: 'Wujie' }),
    }));

    expect(response.status).toBe(401);
    expect(mocks.findProviderById).not.toHaveBeenCalled();
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
  });
});
