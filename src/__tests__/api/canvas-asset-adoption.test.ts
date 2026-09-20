import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  prepareVerifiedLegacyProjectMedia: vi.fn(),
  migrateLegacyProjectOnWrite: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/persist-result-image', () => ({ persistResultImage: vi.fn() }));
vi.mock('@/lib/asset-core/legacy-migration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/legacy-migration')>();
  return {
    ...actual,
    prepareVerifiedLegacyProjectMedia: mocks.prepareVerifiedLegacyProjectMedia,
    migrateLegacyProjectOnWrite: mocks.migrateLegacyProjectOnWrite,
  };
});

import { POST } from '@/app/api/assets/adopt-canvas-image/route';

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/assets/adopt-canvas-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/assets/adopt-canvas-image', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.prepareVerifiedLegacyProjectMedia.mockResolvedValue({
      'image-1': {
        url: '/api/serve-upload/legacy.png',
        mimeType: 'image/png',
        byteSize: 72,
        width: 2,
        height: 2,
      },
      'image-2': {
        url: '/api/serve-upload/other.png',
        mimeType: 'image/png',
        byteSize: 80,
        width: 3,
        height: 3,
      },
    });
    mocks.migrateLegacyProjectOnWrite.mockResolvedValue({
      reused: true,
      mappings: {
        'image-1': { assetId: 'asset-1', versionId: 'version-1', placementId: 'placement-1' },
      },
      project: { canvasImages: [{ id: 'image-1', url: '/api/serve-upload/legacy.png' }] },
    });
  });

  it('uses only the authenticated owner and returns the exact migrated image mapping', async () => {
    const response = await POST(request({ projectId: 'project-1', imageId: 'image-1' }));

    expect(response.status).toBe(200);
    expect(mocks.prepareVerifiedLegacyProjectMedia).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'owner-1',
      projectId: 'project-1',
      inspectManagedMedia: expect.any(Function),
    }));
    expect(mocks.migrateLegacyProjectOnWrite).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'owner-1',
      projectId: 'project-1',
      persistMedia: expect.any(Function),
      verifiedMediaByImageId: expect.objectContaining({
        'image-1': expect.objectContaining({ mimeType: 'image/png', byteSize: 72 }),
        'image-2': expect.objectContaining({ mimeType: 'image/png', byteSize: 80 }),
      }),
    }));
    expect(mocks.prepareVerifiedLegacyProjectMedia.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.migrateLegacyProjectOnWrite.mock.invocationCallOrder[0]);
    await expect(response.json()).resolves.toEqual({
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      placementId: 'placement-1',
      url: '/api/serve-upload/legacy.png',
      reused: true,
    });
  });

  it('rejects unauthenticated, client-owned, and unknown image requests', async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const unauthenticated = await POST(request({ projectId: 'project-1', imageId: 'image-1' }));
    const clientOwner = await POST(request({ projectId: 'project-1', imageId: 'image-1', ownerId: 'other' }));
    const unknownImage = await POST(request({ projectId: 'project-1', imageId: 'missing' }));

    expect(unauthenticated.status).toBe(401);
    expect(clientOwner.status).toBe(400);
    expect(unknownImage.status).toBe(404);
  });
});
