import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  findOwnedAnnotationSource: vi.fn(),
  submit: vi.fn(),
  get: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.requireApiAuthOrReject }));
vi.mock('@/lib/annotation-project-source', () => ({
  findOwnedAnnotationSource: mocks.findOwnedAnnotationSource,
}));
vi.mock('@/lib/element-decomposition/service', () => ({
  submitElementDecomposition: mocks.submit,
  getElementDecomposition: mocks.get,
  retryElementBranch: mocks.retry,
  cancelElementDecomposition: mocks.cancel,
  ElementDecompositionError: class ElementDecompositionError extends Error {
    code: string; status: number; retryable: boolean;
    constructor(code: string, message: string, status = 500, retryable = false) {
      super(message); this.code = code; this.status = status; this.retryable = retryable;
    }
  },
}));

function body(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    sourceImageId: 'image-1',
    sourceVersionId: 'image-1:1:source',
    imageUrl: '/api/serve-upload/source.png',
    outputMode: 'both',
    board: {
      aspectRatio: '16:9',
      background: 'transparent',
      providerId: 'image-provider',
      modelId: 'gpt-image-1',
    },
    layers: { engine: 'cloud', providerId: 'pear', modelId: 'Image-Layered' },
    ...overrides,
  };
}

describe('/api/element-decompose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({ userId: 'user-1', userRole: 'user' });
    mocks.findOwnedAnnotationSource.mockResolvedValue({
      projectId: 'project-1',
      imageId: 'image-1',
      imageUrl: '/api/serve-upload/source.png',
      versionId: 'image-1:1:source',
    });
    mocks.submit.mockResolvedValue({ taskId: 'parent-1', status: 'processing' });
    mocks.get.mockResolvedValue({ taskId: 'parent-1', status: 'processing' });
    mocks.retry.mockResolvedValue({ taskId: 'parent-1', status: 'processing' });
    mocks.cancel.mockResolvedValue({ taskId: 'parent-1', status: 'cancelled' });
  });

  it('rejects unauthenticated requests', async () => {
    const unauthorized = NextResponse.json({ success: false }, { status: 401 });
    mocks.requireApiAuthOrReject.mockResolvedValue(unauthorized);
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('submits a normalized authenticated parent request', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(202);
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', idempotencyKey: 'element-001', request: expect.objectContaining({
        projectId: 'project-1',
        outputMode: 'both',
        imageUrl: '/api/serve-upload/source.png',
        board: expect.objectContaining({
          providerId: 'image-provider',
          modelId: 'gpt-image-1',
        }),
        layers: expect.objectContaining({
          providerId: 'pear',
          modelId: 'Image-Layered',
        }),
      }),
    }));
  });

  it('requires an explicit board provider and model when the board output is requested', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST',
      body: JSON.stringify(body({
        board: { aspectRatio: '16:9', background: 'transparent' },
      })),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'element-board-model' },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_BOARD_PROVIDER_REQUIRED' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('does not require a board model for a layers-only request', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST',
      body: JSON.stringify(body({
        outputMode: 'layers',
        board: { aspectRatio: '16:9', background: 'transparent' },
      })),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'element-layers-only' },
    }));

    expect(response.status).toBe(202);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it('rejects a declared body larger than 128 KiB before calling the service', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST',
      body: JSON.stringify(body()),
      headers: {
        'content-type': 'application/json',
        'content-length': String(128 * 1024 + 1),
        'idempotency-key': 'element-001',
      },
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_BODY_TOO_LARGE' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects a streamed body larger than 128 KiB', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST',
      body: JSON.stringify(body({ padding: 'x'.repeat(128 * 1024) })),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_BODY_TOO_LARGE' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('returns a stable error for malformed JSON', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST',
      body: '{broken',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_JSON_INVALID' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects invalid output modes before submission', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body({ outputMode: 'unknown' })), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects unsupported board aspect ratios', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST',
      body: JSON.stringify(body({ board: { aspectRatio: '7:5', background: 'transparent' } })),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_BOARD_RATIO_INVALID' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects a source image that is not owned by the authenticated user', async () => {
    mocks.findOwnedAnnotationSource.mockResolvedValue(null);
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_SOURCE_NOT_FOUND' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects stale source versions', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body({ sourceVersionId: 'stale-version' })), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_SOURCE_STALE' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('rejects a submitted image URL that differs from the owned source', async () => {
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body({ imageUrl: '/api/serve-upload/other.png' })), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_SOURCE_MISMATCH' });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('preserves stable service error status and code', async () => {
    mocks.submit.mockRejectedValue(Object.assign(new Error('not found'), {
      code: 'ELEMENT_TASK_NOT_FOUND', status: 404, retryable: false,
    }));
    const { POST } = await import('@/app/api/element-decompose/route');
    const response = await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify(body()), headers: { 'content-type': 'application/json', 'idempotency-key': 'element-001' },
    }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'ELEMENT_TASK_NOT_FOUND' });
  });

  it('reads, retries, and cancels only through authenticated service identities', async () => {
    const { GET, POST, DELETE } = await import('@/app/api/element-decompose/route');
    await GET(new NextRequest('http://localhost/api/element-decompose?taskId=parent-1'));
    await POST(new NextRequest('http://localhost/api/element-decompose', {
      method: 'POST', body: JSON.stringify({ action: 'retry', taskId: 'parent-1', branch: 'board' }), headers: { 'content-type': 'application/json' },
    }));
    await DELETE(new NextRequest('http://localhost/api/element-decompose?taskId=parent-1', { method: 'DELETE' }));
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'parent-1', userId: 'user-1' }));
    expect(mocks.retry).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'parent-1', branch: 'board', userId: 'user-1' }));
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'parent-1', userId: 'user-1' }));
  });
});
