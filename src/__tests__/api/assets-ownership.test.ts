import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestUser: vi.fn(),
  transaction: vi.fn(),
  trashPlacement: vi.fn(),
  resolveAssetReference: vi.fn(),
  resolveDocumentReference: vi.fn(),
  resolvePersonalReference: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/collaboration/document-workspace-reference', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/collaboration/document-workspace-reference')>(),
  resolveDocumentWorkspaceReference: mocks.resolveDocumentReference,
  resolvePersonalWorkspaceReference: mocks.resolvePersonalReference,
}));
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
import { DocumentWorkspaceReferenceError } from '@/lib/collaboration/document-workspace-reference';

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
    mocks.resolveDocumentReference.mockResolvedValue(null);
    mocks.resolveAssetReference.mockResolvedValue({ url: '/private.png', assetVersionId: 'version-a', placementId: 'placement-a' });
    mocks.resolvePersonalReference.mockImplementation((actorUserId, input) => mocks.resolveAssetReference({ actorUserId, ...input }));
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

  it('returns the committed project revision for an authenticated idempotent delete retry', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.trashPlacement.mockResolvedValue({
      placementTrashed: false,
      assetTrashed: false,
      projectRevision: 9,
    });

    const response = await deletePlacement(
      new NextRequest('http://localhost/api/assets/placements/placement-a?projectId=project-a', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ placementId: 'placement-a' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ projectRevision: 9 }));
    expect(mocks.trashPlacement).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      projectId: 'project-a',
      placementId: 'placement-a',
    });
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

  it('returns the document canonical reference before consulting the personal asset service', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'editor' });
    const reference = { assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
      entityId: 'entity-a', kind: 'image', url: '/canonical.png' };
    mocks.resolveDocumentReference.mockResolvedValue(reference);
    const response = await resolveAsset(resolveRequest({ projectId: 'shared',
      assetVersionId: 'version-a', placementId: 'placement-a' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(reference);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(mocks.resolveDocumentReference).toHaveBeenCalledWith('editor', {
      projectId: 'shared', assetVersionId: 'version-a', placementId: 'placement-a',
    });
    expect(mocks.resolveAssetReference).not.toHaveBeenCalled();
  });

  it('rejects an expected actor mismatch before any authority or private asset read', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'new-actor' });
    const request = resolveRequest({ projectId: 'shared', assetVersionId: 'version-a', placementId: 'placement-a' });
    request.headers.set('x-wujie-expected-actor-id', 'old-actor');
    const response = await resolveAsset(request);
    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(mocks.resolveDocumentReference).not.toHaveBeenCalled();
    expect(mocks.resolveAssetReference).not.toHaveBeenCalled();
  });

  it.each([['DOCUMENT_FORBIDDEN', 403], ['ASSET_NOT_FOUND', 404], ['ASSET_REFERENCE_UNAVAILABLE', 503]] as const)
    ('keeps %s private and does not fall back to the personal service', async (code, status) => {
      mocks.getSessionUser.mockResolvedValue({ id: 'editor' });
      mocks.resolveDocumentReference.mockRejectedValue(new DocumentWorkspaceReferenceError(code, status));
      const response = await resolveAsset(resolveRequest({ projectId: 'shared', assetVersionId: 'version-a', placementId: 'placement-a' }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: code });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toBe('Cookie');
      expect(mocks.resolveAssetReference).not.toHaveBeenCalled();
    });

  it('returns the trusted asset kind supplied by the asset service', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.resolveAssetReference.mockResolvedValue({
      assetId: 'asset-document', assetVersionId: 'version-document',
      kind: 'document', url: '/api/skill-reports/version-document?format=json',
    });

    const response = await resolveAsset(resolveRequest({
      projectId: 'project-a', assetVersionId: 'version-document',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assetVersionId: 'version-document', kind: 'document',
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
