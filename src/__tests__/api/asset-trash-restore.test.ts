import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  restorePlacement: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/service', () => ({
  AssetServiceError: class AssetServiceError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  createAssetService: () => ({ restorePlacement: mocks.restorePlacement }),
}));

import { POST as restoreAsset } from '@/app/api/assets/[assetId]/restore/route';

describe('asset restore API', () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset();
    mocks.restorePlacement.mockReset();
  });

  it('requires a session before restoring a trashed placement', async () => {
    mocks.getRequestUser.mockResolvedValue(null);
    const response = await restoreAsset(
      new NextRequest('http://localhost/api/assets/asset-a/restore', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-a', placementId: 'placement-a' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ assetId: 'asset-a' }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.restorePlacement).not.toHaveBeenCalled();
  });

  it('restores only the session owners placement inside the retention window', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.restorePlacement.mockResolvedValue({
      placement: { id: 'placement-a', status: 'active' },
      asset: { id: 'asset-a', status: 'active' },
      projectRevision: 7,
    });
    const response = await restoreAsset(
      new NextRequest('http://localhost/api/assets/asset-a/restore', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-a', placementId: 'placement-a' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ assetId: 'asset-a' }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.restorePlacement).toHaveBeenCalledWith({
      actorUserId: 'owner-a', projectId: 'project-a', placementId: 'placement-a', assetId: 'asset-a',
    });
    expect(await response.json()).toEqual(expect.objectContaining({ projectRevision: 7 }));
  });
});
