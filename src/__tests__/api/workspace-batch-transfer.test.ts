import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AssetServiceError } from '@/lib/asset-core/service';
import { transferCanvasSkillAssets } from '@/lib/skill-runtime/canvas-client';
import { expectedActorHeaders } from '@/lib/expected-actor-header';

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
import { POST as POSTActorV2 } from '@/app/api/assets/actor-v2/batch-transfer/route';

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

  it('rejects a mismatched expected account before touching assets', async () => {
    const req = request({ transfers: [transfer(1)] });
    req.headers.set('x-wujie-expected-actor-id', 'owner-b');
    const response = await POST(req);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'ACTOR_SCOPE_CHANGED' });
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it('accepts a matching expected account', async () => {
    const req = request({ transfers: [transfer(1)] });
    req.headers.set('x-wujie-expected-actor-id', 'owner-a');
    expect((await POST(req)).status).toBe(200);
    expect(mocks.sendVersionsToWorkspace).toHaveBeenCalledOnce();
  });

  it('rejects the real canvas batch client before reaching storage when the session changes', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-b', role: 'user' });
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url !== '/api/assets/batch-transfer' && url !== '/api/assets/actor-v2/batch-transfer') {
        throw new Error(`Unexpected asset endpoint: ${url}`);
      }
      const handler = url === '/api/assets/actor-v2/batch-transfer' ? POSTActorV2 : POST;
      return handler(new NextRequest(`http://localhost${url}`, { ...init, signal: init?.signal ?? undefined }));
    };
    await expect(transferCanvasSkillAssets({
      references: [{ url: '/image-1.png', assetVersionId: 'version-1' }],
      projectId: 'project-a', expectedActorId: 'owner-a', runId: 'run-a',
      sourceVersionIds: [], fetcher,
    })).rejects.toThrow();
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it('accepts a non-ASCII account ID through the canvas batch client and route', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: '用户甲', role: 'user' });
    mocks.sendVersionsToWorkspace.mockResolvedValue([{
      version: { id: 'version-1', assetId: 'asset-1', file: { url: '/image-1.png' } },
      placement: { id: 'placement-1', entityId: 'canvas-skill:run-a:version-1', status: 'active' }, reused: false,
    }]);
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url !== '/api/assets/batch-transfer' && url !== '/api/assets/actor-v2/batch-transfer') {
        throw new Error(`Unexpected asset endpoint: ${url}`);
      }
      const handler = url === '/api/assets/actor-v2/batch-transfer' ? POSTActorV2 : POST;
      return handler(new NextRequest(`http://localhost${url}`, { ...init, signal: init?.signal ?? undefined }));
    };
    const result = await transferCanvasSkillAssets({
      references: [{ url: '/image-1.png', assetVersionId: 'version-1' }],
      projectId: 'project-a', expectedActorId: '用户甲', runId: 'run-a',
      sourceVersionIds: [], fetcher,
    });
    expect(result[0].assetVersionId).toBe('version-1');
    expect(mocks.sendVersionsToWorkspace).toHaveBeenCalledOnce();
  });

  it('rejects a different non-ASCII account through the canvas batch client and route', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: '用户乙', role: 'user' });
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url !== '/api/assets/batch-transfer' && url !== '/api/assets/actor-v2/batch-transfer') {
        throw new Error(`Unexpected asset endpoint: ${url}`);
      }
      const handler = url === '/api/assets/actor-v2/batch-transfer' ? POSTActorV2 : POST;
      return handler(new NextRequest(`http://localhost${url}`, { ...init, signal: init?.signal ?? undefined }));
    };
    await expect(transferCanvasSkillAssets({
      references: [{ url: '/image-1.png', assetVersionId: 'version-1' }],
      projectId: 'project-a', expectedActorId: '用户甲', runId: 'run-a',
      sourceVersionIds: [], fetcher,
    })).rejects.toThrow();
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    { 'x-wujie-expected-actor-id': '%E7%94', 'x-wujie-expected-actor-id-encoding': 'percent-utf8' },
    { 'x-wujie-expected-actor-id': 'owner-a', 'x-wujie-expected-actor-id-encoding': 'unknown' },
    { 'x-wujie-expected-actor-id-encoding': 'percent-utf8' },
    { 'x-wujie-expected-actor-id': '', 'x-wujie-expected-actor-id-encoding': 'percent-utf8' },
  ])('rejects malformed or incomplete encoded account headers', async headers => {
    const req = request({ transfers: [transfer(1)] });
    for (const [name, value] of Object.entries(headers)) if (typeof value === 'string') req.headers.set(name, value);
    expect((await POST(req)).status).toBe(400);
    expect(mocks.sendVersionsToWorkspace).not.toHaveBeenCalled();
  });

  it('keeps percent signs literal in a legacy unencoded account header', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'owner%2Fa', role: 'user' });
    const req = request({ transfers: [transfer(1)] });
    req.headers.set('x-wujie-expected-actor-id', 'owner%2Fa');
    expect((await POST(req)).status).toBe(200);
  });

  it('keeps printable ASCII IDs literal for compatibility with older services', () => {
    expect(expectedActorHeaders('owner%2Fa')).toEqual({ 'x-wujie-expected-actor-id': 'owner%2Fa' });
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

  it('accepts video canvas placements and restores a deleted placement without copying its version', async () => {
    mocks.sendVersionsToWorkspace.mockResolvedValueOnce([{
      version: { id: 'version-1', assetId: 'asset-1', file: { url: '/video-1.mp4' } },
      placement: { id: 'placement-1', entityId: 'simple-chat:task-1:message-1:0', status: 'active' },
      reused: true,
    }]);
    const response = await POST(request({
      transfers: [{ ...transfer(1), entityType: 'canvas-video', entityId: 'simple-chat:task-1:message-1:0' }],
      restoreDeletedPlacements: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.sendVersionsToWorkspace).toHaveBeenCalledWith([
      expect.objectContaining({ sourceVersionId: 'version-1', entityType: 'canvas-video' }),
    ], { restoreDeletedPlacements: true });
    await expect(response.json()).resolves.toMatchObject({
      transfers: [{ assetVersionId: 'version-1', placementId: 'placement-1', placementStatus: 'active' }],
    });
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
