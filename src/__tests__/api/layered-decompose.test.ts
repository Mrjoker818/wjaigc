import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAuthOrReject: vi.fn(),
  submitLayerDecomposition: vi.fn(),
  getLayerTaskStatus: vi.fn(),
  cancelLayerTask: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: mocks.requireApiAuthOrReject,
}));

vi.mock('@/lib/layer-decomposition/service', () => ({
  submitLayerDecomposition: mocks.submitLayerDecomposition,
  getLayerTaskStatus: mocks.getLayerTaskStatus,
  cancelLayerTask: mocks.cancelLayerTask,
  LayerServiceError: class LayerServiceError extends Error {
    code = 'TEST_ERROR';
    status = 400;
    retryable = false;
  },
}));

import { DELETE, GET, POST } from '@/app/api/layered-decompose/route';

describe('layered decomposition route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'user',
    });
  });

  it('rejects unauthenticated submission before service execution', async () => {
    mocks.requireApiAuthOrReject.mockResolvedValue(
      NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    );
    const response = await POST(new NextRequest('http://localhost/api/layered-decompose', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: '/api/serve-upload/source.png' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(401);
    expect(mocks.submitLayerDecomposition).not.toHaveBeenCalled();
  });

  it('submits one authenticated bounded request through the shared service', async () => {
    mocks.submitLayerDecomposition.mockResolvedValue({
      success: true,
      taskId: 'layer-1',
      status: 'processing',
      phase: 'waiting-for-pear',
      progress: 15,
    });
    const response = await POST(new NextRequest('http://localhost/api/layered-decompose', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: '/api/serve-upload/source.png',
        engine: 'smart',
        providerId: 'pear',
        modelId: 'Image-Layered',
      }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'layer-request-1',
      },
    }));

    expect(response.status).toBe(202);
    expect(mocks.submitLayerDecomposition).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      userRole: 'user',
      idempotencyKey: 'layer-request-1',
      request: expect.objectContaining({ providerId: 'pear', modelId: 'Image-Layered' }),
    }));
  });

  it('normalizes a same-origin managed media URL before service execution', async () => {
    mocks.submitLayerDecomposition.mockResolvedValue({
      success: true,
      taskId: 'layer-managed-media',
      status: 'processing',
      phase: 'reading-source',
      progress: 5,
    });
    const response = await POST(new NextRequest(
      'https://preview.example/api/layered-decompose',
      {
        method: 'POST',
        body: JSON.stringify({
          imageUrl: 'https://preview.example/api/serve-upload/generate/source.png?cache=1',
          engine: 'cloud',
          providerId: 'pear',
          modelId: 'Image-Layered',
        }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'layer-managed-media-1',
        },
      },
    ));

    expect(response.status).toBe(202);
    expect(mocks.submitLayerDecomposition).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        imageUrl: '/api/serve-upload/generate/source.png',
      }),
    }));
  });

  it('delegates status and cancellation with task ownership identity', async () => {
    mocks.getLayerTaskStatus.mockResolvedValue({
      success: true,
      taskId: 'layer-1',
      status: 'processing',
      progress: 42,
    });
    mocks.cancelLayerTask.mockResolvedValue({
      success: true,
      taskId: 'layer-1',
      status: 'cancelled',
      progress: 42,
    });

    const getResponse = await GET(new NextRequest(
      'http://localhost/api/layered-decompose?taskId=layer-1',
    ));
    const deleteResponse = await DELETE(new NextRequest(
      'http://localhost/api/layered-decompose?taskId=layer-1',
      { method: 'DELETE' },
    ));

    expect(getResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(mocks.getLayerTaskStatus).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'layer-1', userId: 'user-1',
    }));
    expect(mocks.cancelLayerTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'layer-1', userId: 'user-1',
    }));
  });
});
