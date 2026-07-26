import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  dbGetUserData: vi.fn(),
  identifyImageTargetAtPoint: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
}));
vi.mock('@/lib/identify-subject', () => ({
  identifyImageTargetAtPoint: mocks.identifyImageTargetAtPoint,
}));

import { POST } from '@/app/api/annotations/resolve-target/route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/annotations/resolve-target', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/annotations/resolve-target', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'user',
    });
    mocks.dbGetUserData.mockResolvedValue([
      {
        id: 'project-1',
        userId: 'user-1',
        canvasImages: [{
          id: 'image-1',
          url: 'https://example.com/owned-source.png',
          annotationVersionId: 'version-1',
        }],
      },
    ]);
  });

  it('rejects unauthenticated requests before parsing or resolving an image', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );

    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 0.5, y: 0.5 },
    }));

    expect(response.status).toBe(401);
    expect(mocks.dbGetUserData).not.toHaveBeenCalled();
    expect(mocks.identifyImageTargetAtPoint).not.toHaveBeenCalled();
  });

  it('does not disclose or resolve a project the user does not own', async () => {
    mocks.dbGetUserData.mockResolvedValue([
      { id: 'other-project', userId: 'user-1' },
    ]);

    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 0.5, y: 0.5 },
    }));

    expect(response.status).toBe(404);
    expect(mocks.identifyImageTargetAtPoint).not.toHaveBeenCalled();
  });

  it('rejects a point outside normalized image coordinates', async () => {
    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 1.2, y: 0.5 },
    }));

    expect(response.status).toBe(400);
    expect(mocks.identifyImageTargetAtPoint).not.toHaveBeenCalled();
  });

  it('requires confirmation when semantic confidence is below 0.72', async () => {
    mocks.identifyImageTargetAtPoint.mockResolvedValue({
      label: 'coffee cup',
      confidence: 0.71,
      region: { x: 0.2, y: 0.2, w: 0.3, h: 0.4 },
    });

    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 0.3, y: 0.4 },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      requiresConfirmation: true,
      target: { label: 'coffee cup', confidence: 0.71 },
      modelSelection: { mode: 'auto-authorized' },
    });
  });

  it('returns an explicit failure when no semantic target can be resolved', async () => {
    mocks.identifyImageTargetAtPoint.mockResolvedValue(null);

    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      point: { x: 0.3, y: 0.4 },
    }));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.code).toBe('ANNOTATION_TARGET_NOT_FOUND');
  });

  it('rejects a source image that is not owned by the project', async () => {
    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'foreign-image',
      sourceVersionId: 'version-1',
      point: { x: 0.3, y: 0.4 },
    }));

    expect(response.status).toBe(404);
    expect(mocks.identifyImageTargetAtPoint).not.toHaveBeenCalled();
  });

  it('rejects a stale source version before vision analysis', async () => {
    const response = await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'stale-version',
      point: { x: 0.3, y: 0.4 },
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('ANNOTATION_SOURCE_STALE');
    expect(mocks.identifyImageTargetAtPoint).not.toHaveBeenCalled();
  });

  it('resolves only the server-stored image URL', async () => {
    mocks.identifyImageTargetAtPoint.mockResolvedValue({
      label: 'cup',
      confidence: 0.9,
      region: { x: 0.2, y: 0.2, w: 0.3, h: 0.4 },
    });

    await POST(request({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      imageUrl: 'https://attacker.example/other.png',
      point: { x: 0.3, y: 0.4 },
    }));

    expect(mocks.identifyImageTargetAtPoint).toHaveBeenCalledWith(
      'https://example.com/owned-source.png',
      { x: 0.3, y: 0.4 },
      30_000,
      { userId: 'user-1', userRole: 'user' },
    );
  });
});

describe('semantic target strict JSON parsing', () => {
  it('accepts only the documented target schema and clamps vision bounds', async () => {
    const actual = await import('@/lib/annotation-target-parser');

    expect(actual.parseIdentifiedImageTargetPayload(JSON.stringify({
      label: 'cup',
      confidence: 0.8,
      region: { x: 0.9, y: 0.8, w: 0.4, h: 0.5 },
    }))).toEqual({
      label: 'cup',
      confidence: 0.8,
      region: { x: 0.9, y: 0.8, w: 0.1, h: 0.2 },
    });
    expect(actual.parseIdentifiedImageTargetPayload(JSON.stringify({
      label: 'cup',
      confidence: 'high',
      region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    }))).toBeNull();
  });
});
