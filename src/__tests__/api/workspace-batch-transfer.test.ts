import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AssetServiceError } from '@/lib/asset-core/service';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  sendVersionsToWorkspace: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/asset-core/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/service')>();
  return {
    ...actual,
    createAssetService: () => ({ sendVersionsToWorkspace: mocks.sendVersionsToWorkspace }),
  };
});

import { POST } from '@/app/api/assets/batch-transfer/route';

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/assets/batch-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function streamingRequest(stream: ReadableStream<Uint8Array>): NextRequest {
  return new Request('http://localhost/api/assets/batch-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }) as NextRequest;
}

const transfer = (index: number) => ({
  sourceVersion: `version-${index}`,
  targetProject: 'project-a',
  targetWorkspace: 'canvas:project-a',
  entityType: 'canvas-image',
  entityId: `canvas-skill:run-a:version-${index}`,
  idempotencyKey: `canvas-skill:run-a:version-${index}`,
  metadata: { source: 'canvas-skill', runId: 'run-a' },
});

describe('POST /api/assets/batch-transfer', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset().mockResolvedValue({ id: 'owner-a', role: 'user' });
    mocks.sendVersionsToWorkspace.mockReset().mockResolvedValue([1, 2].map(index => ({
      version: { id: `version-${index}`, assetId: `asset-${index}`, file: { url: `/image-${index}.png` } },
      placement: { id: `placement-${index}`, entityId: `canvas-skill:run-a:version-${index}`, status: 'active' },
      reused: false,
    })));
  });

  it('commits all transfers through one service transaction and returns the complete batch', async () => {
    const response = await POST(request({ transfers: [transfer(1), transfer(2)] }));

    expect(response.status).toBe(200);
    expect(mocks.sendVersionsToWorkspace).toHaveBeenCalledOnce();
    expect(mocks.sendVersionsToWorkspace.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.sendVersionsToWorkspace.mock.calls[0][1]).toEqual({ restoreDeletedPlacements: false });
    await expect(response.json()).resolves.toMatchObject({
      transfers: [
        { assetVersionId: 'version-1', placementId: 'placement-1' },
        { assetVersionId: 'version-2', placementId: 'placement-2' },
      ],
    });
  });

  it('keeps explicit deleted-placement recovery inside the same service transaction', async () => {
    const response = await POST(request({ transfers: [transfer(1)], restoreDeletedPlacements: true }));
    expect(response.status).toBe(200);
    expect(mocks.sendVersionsToWorkspace.mock.calls[0][1]).toEqual({ restoreDeletedPlacements: true });
  });

  it('rejects oversized nested metadata before reaching storage', async () => {
    const oversized = { ...transfer(1), metadata: { value: 'x'.repeat(2_049) } };
    expect((await POST(request({ transfers: [oversized] }))).status).toBe(400);
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a canvas workspace that belongs to a different target project', async () => {
    const mismatched = { ...transfer(1), targetWorkspace: 'canvas:project-b' };

    const response = await POST(request({ transfers: [mismatched] }));

    expect(response.status).toBe(400);
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized batch before reaching storage', async () => {
    expect((await POST(request({ transfers: [] }))).status).toBe(400);
    expect((await POST(request({ transfers: Array.from({ length: 101 }, (_, index) => transfer(index)) }))).status).toBe(400);
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it('cancels a chunked request as soon as it exceeds the byte limit', async () => {
    let pulls = 0;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(140 * 1024).fill(0x20));
        if (pulls === 10) controller.close();
      },
      cancel: cancelled,
    });

    const response = await POST(streamingRequest(stream));

    expect(response.status).toBe(413);
    expect(pulls).toBeLessThan(10);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it.each(['ASSET_RESTORE_NOT_ALLOWED', 'ASSET_MEDIA_UNRECOVERABLE'] as const)(
    'returns a stable conflict response for %s',
    async (code) => {
      mocks.sendVersionsToWorkspace.mockRejectedValueOnce(new AssetServiceError(code));

      const response = await POST(request({ transfers: [transfer(1)], restoreDeletedPlacements: true }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: code });
    },
  );
});
