import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  dbGetBrandAssets: vi.fn(),
  dbGetBrandAsset: vi.fn(),
  dbUpsertBrandAsset: vi.fn(),
  dbDeleteBrandAsset: vi.fn(),
  dbSetDefaultBrandAsset: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db-storage', () => ({
  dbGetBrandAssets: mocks.dbGetBrandAssets,
  dbGetBrandAsset: mocks.dbGetBrandAsset,
  dbUpsertBrandAsset: mocks.dbUpsertBrandAsset,
  dbDeleteBrandAsset: mocks.dbDeleteBrandAsset,
  dbSetDefaultBrandAsset: mocks.dbSetDefaultBrandAsset,
}));
vi.mock('@/lib/api-validator', () => ({ validateApiInputs: () => null }));

import { GET, POST } from '@/app/api/brand-assets/route';

function request(method: 'GET' | 'POST', body?: Record<string, unknown>, search = ''): NextRequest {
  return new NextRequest(`http://localhost/api/brand-assets${search}`, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('brand asset ownership', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue({ authenticated: true, userId: 'owner-1', userRole: 'user' });
  });

  it('lists only the authenticated user assets even when another userId is supplied', async () => {
    mocks.dbGetBrandAssets.mockResolvedValue([]);

    const response = await GET(request('GET', undefined, '?userId=other-user'));

    expect(response.status).toBe(200);
    expect(mocks.dbGetBrandAssets).toHaveBeenCalledWith('owner-1');
  });

  it('does not return an asset owned by a different user', async () => {
    mocks.dbGetBrandAsset.mockResolvedValue({ id: 'foreign-asset', user_id: 'other-user' });

    const response = await POST(request('POST', { action: 'get', id: 'foreign-asset' }));

    expect(response.status).toBe(403);
  });

  it('does not allow an existing foreign asset ID to be overwritten', async () => {
    mocks.dbGetBrandAsset.mockResolvedValue({ id: 'foreign-asset', user_id: 'other-user' });

    const response = await POST(request('POST', { action: 'save', id: 'foreign-asset', name: 'Attempt overwrite' }));

    expect(response.status).toBe(403);
    expect(mocks.dbUpsertBrandAsset).not.toHaveBeenCalled();
  });
});
