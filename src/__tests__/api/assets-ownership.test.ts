import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestUser: vi.fn(),
  transaction: vi.fn(),
  trashPlacement: vi.fn(),
  resolveAssetReference: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/storage', () => ({
  createPostgresAssetStorage: () => ({ transaction: mocks.transaction }),
}));
vi.mock('@/lib/asset-core/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/service')>();
  return {
    ...actual,
    createAssetService: () => ({
      trashPlacement: mocks.trashPlacement,
      resolveAssetReference: mocks.resolveAssetReference,
    }),
  };
});

import { POST as resolveAsset } from '@/app/api/assets/route';
import { DELETE as deletePlacement } from '@/app/api/assets/placements/[placementId]/route';
import { AssetServiceError } from '@/lib/asset-core/service';

function resolveRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('asset API ownership', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getRequestUser.mockResolvedValue(null);
  });

  it('returns 401 before reading asset storage when there is no session', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.getRequestUser.mockResolvedValue({
      source: 'internal',
      user: { id: 'internal-owner', role: 'user' },
    });
    mocks.transaction.mockImplementation(async (callback) => callback({
      findProject: vi.fn().mockResolvedValue(true),
      findVersion: vi.fn().mockResolvedValue({
        id: 'version-a',
        assetId: 'asset-a',
        file: { url: '/api/serve-upload/source.png' },
      }),
      findPlacement: vi.fn(),
    }));

    const response = await resolveAsset(resolveRequest({
      projectId: 'project-a',
      assetVersionId: 'version-a',
    }));

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.resolveAssetReference).not.toHaveBeenCalled();
  });

  it('returns 401 before deleting a placement when there is no session', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.getRequestUser.mockResolvedValue({
      source: 'internal',
      user: { id: 'internal-owner', role: 'user' },
    });
    mocks.trashPlacement.mockResolvedValue({ placementTrashed: true, assetTrashed: false });

    const response = await deletePlacement(
      new NextRequest('http://localhost/api/assets/placements/placement-a?projectId=project-a', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ placementId: 'placement-a' }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.trashPlacement).not.toHaveBeenCalled();
  });

  it('uses the same 404 response for another users project and version', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.resolveAssetReference.mockRejectedValue(new AssetServiceError('ASSET_NOT_FOUND'));

    const foreignProject = await resolveAsset(resolveRequest({
      projectId: 'foreign-project',
      assetVersionId: 'version-a',
    }));
    const foreignVersion = await resolveAsset(resolveRequest({
      projectId: 'project-a',
      assetVersionId: 'foreign-version',
    }));

    expect(foreignProject.status).toBe(404);
    expect(foreignVersion.status).toBe(404);
    await expect(foreignProject.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
    await expect(foreignVersion.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
    expect(mocks.resolveAssetReference).toHaveBeenNthCalledWith(1, {
      actorUserId: 'owner-1',
      projectId: 'foreign-project',
      assetVersionId: 'version-a',
    });
    expect(mocks.resolveAssetReference).toHaveBeenNthCalledWith(2, {
      actorUserId: 'owner-1',
      projectId: 'project-a',
      assetVersionId: 'foreign-version',
    });
  });

  it('injects the session owner when deleting a placement and masks foreign placement ownership', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.trashPlacement.mockRejectedValue(new AssetServiceError('ASSET_NOT_FOUND'));

    const response = await deletePlacement(
      new NextRequest('http://localhost/api/assets/placements/placement-a?projectId=project-a&ownerId=other-user', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ placementId: 'placement-a' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
    expect(mocks.trashPlacement).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      projectId: 'project-a',
      placementId: 'placement-a',
    });
  });
});
