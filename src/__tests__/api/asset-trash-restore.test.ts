import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  restorePlacement: vi.fn(),
}));

const MockAssetServiceError = vi.hoisted(() => class AssetServiceError extends Error {
  constructor(readonly code: string) { super(code); }
});

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/service', () => ({
  AssetServiceError: MockAssetServiceError,
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

  it('returns 409 when the selected media is unrecoverable', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.restorePlacement.mockRejectedValue(
      new MockAssetServiceError('ASSET_MEDIA_UNRECOVERABLE'),
    );

    const response = await restoreAsset(
      new NextRequest('http://localhost/api/assets/asset-a/restore', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-a', placementId: 'placement-a' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ assetId: 'asset-a' }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'ASSET_MEDIA_UNRECOVERABLE' });
  });

  it('forwards a supplied placement revision to the authenticated atomic restore', async () => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    mocks.restorePlacement.mockRejectedValue(new MockAssetServiceError('ASSET_PLACEMENT_CONFLICT'));
    const response = await restoreAsset(new NextRequest('http://localhost/api/assets/asset-a/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', placementId: 'placement-a', expectedPlacementRevision: '42' }),
    }), { params: Promise.resolve({ assetId: 'asset-a' }) });
    expect(mocks.restorePlacement).toHaveBeenCalledWith({
      actorUserId: 'owner-a', projectId: 'project-a', placementId: 'placement-a', assetId: 'asset-a',
      expectedPlacementRevision: '42',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'ASSET_PLACEMENT_CONFLICT' });
  });

  it.each(['', 'invalid', '12345678901', 42, null])('rejects malformed restore revision %j', async revision => {
    mocks.getRequestUser.mockResolvedValue({ user: { id: 'owner-a', role: 'user' } });
    const response = await restoreAsset(new NextRequest('http://localhost/api/assets/asset-a/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-a', placementId: 'placement-a', expectedPlacementRevision: revision }),
    }), { params: Promise.resolve({ assetId: 'asset-a' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'ASSET_REQUEST_INVALID' });
    expect(mocks.restorePlacement).not.toHaveBeenCalled();
  });

  it('keeps the unrecoverable terminal conflict explicit in the route map', () => {
    const routeSource = readFileSync(
      path.join(process.cwd(), 'src/app/api/assets/[assetId]/restore/route.ts'),
      'utf8',
    );

    expect(routeSource).toContain("error.code === 'ASSET_MEDIA_UNRECOVERABLE'");
  });
});
