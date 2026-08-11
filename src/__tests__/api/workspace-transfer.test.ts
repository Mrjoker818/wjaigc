import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestUser: vi.fn(),
  sendVersionToWorkspace: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/service')>();
  return {
    ...actual,
    createAssetService: () => ({ sendVersionToWorkspace: mocks.sendVersionToWorkspace }),
  };
});

import { POST } from '@/app/api/assets/transfer/route';
import { AssetServiceError } from '@/lib/asset-core/service';

const baseBody = {
  sourceVersion: 'version-a',
  targetProject: 'project-a',
  targetWorkspace: 'embedded-chat-project-a',
  entityType: 'chat-attachment',
  entityId: 'message-image-a',
  idempotencyKey: 'canvas-chat-version-a',
  transform: { y: 2, x: 1 },
  metadata: { label: 'reference', source: 'canvas' },
};

function transferRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/assets/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function transferResult(reused = false) {
  return {
    version: {
      id: 'version-a',
      assetId: 'asset-a',
      file: { url: '/api/serve-upload/source.png' },
    },
    placement: { id: 'placement-a' },
    reused,
  };
}

describe('POST /api/assets/transfer', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', role: 'user' });
    mocks.getRequestUser.mockResolvedValue(null);
    mocks.sendVersionToWorkspace.mockResolvedValue(transferResult());
  });

  it('returns 401 without a session and never reaches the service', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.getRequestUser.mockResolvedValue({
      source: 'internal',
      user: { id: 'internal-owner', role: 'user' },
    });

    const response = await POST(transferRequest(baseBody));

    expect(response.status).toBe(401);
    expect(mocks.sendVersionToWorkspace).not.toHaveBeenCalled();
  });

  it('accepts only the brief fields and never accepts an owner or client digest', async () => {
    const ownerResponse = await POST(transferRequest({ ...baseBody, ownerId: 'other-user' }));
    const digestResponse = await POST(transferRequest({ ...baseBody, requestDigest: 'client-controlled' }));

    expect(ownerResponse.status).toBe(400);
    expect(digestResponse.status).toBe(400);
    expect(mocks.sendVersionToWorkspace).not.toHaveBeenCalled();
  });

  it('injects the session actor, generates a canonical digest, and keeps the compatibility URL', async () => {
    mocks.sendVersionToWorkspace
      .mockResolvedValueOnce(transferResult())
      .mockResolvedValueOnce(transferResult(true));

    const first = await POST(transferRequest(baseBody));
    const second = await POST(transferRequest({
      ...baseBody,
      transform: { x: 1, y: 2 },
      metadata: { source: 'canvas', label: 'reference' },
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstCall = mocks.sendVersionToWorkspace.mock.calls[0][0];
    const secondCall = mocks.sendVersionToWorkspace.mock.calls[1][0];
    expect(firstCall).toMatchObject({
      actorUserId: 'owner-1',
      sourceVersionId: 'version-a',
      targetProjectId: 'project-a',
      targetWorkspaceId: 'embedded-chat-project-a',
    });
    expect(firstCall.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(secondCall.requestDigest).toBe(firstCall.requestDigest);
    await expect(first.json()).resolves.toEqual({
      assetId: 'asset-a',
      assetVersionId: 'version-a',
      placementId: 'placement-a',
      url: '/api/serve-upload/source.png',
      reused: false,
    });
  });

  it('returns 409 when the same key is reused with a different canonical digest', async () => {
    const digests = new Map<string, string>();
    mocks.sendVersionToWorkspace.mockImplementation(async (input) => {
      const previous = digests.get(input.idempotencyKey);
      if (previous && previous !== input.requestDigest) {
        throw new AssetServiceError('ASSET_IDEMPOTENCY_CONFLICT');
      }
      digests.set(input.idempotencyKey, input.requestDigest);
      return transferResult(Boolean(previous));
    });

    const first = await POST(transferRequest(baseBody));
    const conflict = await POST(transferRequest({
      ...baseBody,
      metadata: { ...baseBody.metadata, label: 'changed' },
    }));

    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: 'ASSET_IDEMPOTENCY_CONFLICT' });
  });

  it('uses the same 404 shape for an unreadable source version and unwritable target project', async () => {
    mocks.sendVersionToWorkspace.mockRejectedValue(new AssetServiceError('ASSET_NOT_FOUND'));

    const sourceResponse = await POST(transferRequest({ ...baseBody, sourceVersion: 'foreign-version' }));
    const projectResponse = await POST(transferRequest({ ...baseBody, targetProject: 'foreign-project' }));

    expect(sourceResponse.status).toBe(404);
    expect(projectResponse.status).toBe(404);
    await expect(sourceResponse.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
    await expect(projectResponse.json()).resolves.toEqual({ error: 'ASSET_NOT_FOUND' });
  });
});
