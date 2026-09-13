import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInternalRequestHeaders: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));

import {
  submitGatewayImage,
  submitGatewayVideo,
} from '@/lib/media-gateway/internal-client';

const principal = {
  keyId: 'gwkey_1',
  userId: 'user-1',
  requestsPerMinute: 10,
  dailyQuota: 100,
};

describe('media gateway authoritative internal client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getInternalRequestHeaders.mockResolvedValue({
      'x-internal-request': 'true',
      'x-internal-user-id': 'user-1',
      'x-wujie-internal-secret': 'internal-only',
    });
    process.env.DEPLOY_RUN_PORT = '5123';
  });

  it.each([2, 3, 4])('preserves all %i authoritative image task ids', async (n) => {
    const taskIds = Array.from({ length: n }, (_, index) => `task-${index + 1}`);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      taskId: taskIds[0],
      taskIds,
      status: 'queued',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitGatewayImage({
      principal,
      requestId: 'req_12345678',
      gatewayRequestId: 'gwreq_1',
      input: { prompt: 'draw', providerId: 'provider-1', modelId: 'model-1', n },
    });

    expect(result).toEqual({ kind: 'accepted', taskIds, status: 'queued' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5123/api/generate');
    expect(init.headers).toMatchObject({
      'x-internal-request': 'true',
      'x-wujie-source-channel': 'gateway',
      'x-wujie-gateway-request-id': 'gwreq_1',
      'x-wujie-gateway-key-id': 'gwkey_1',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: 'draw',
      providerId: 'provider-1',
      model: 'model-1',
      n,
      outputCount: n,
      submitOnly: true,
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('modelId');
  });

  it('maps video fields to the existing authoritative video route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      taskId: 'video-task-1', status: 'queued',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitGatewayVideo({
      principal,
      requestId: 'req_12345678',
      gatewayRequestId: 'gwreq_2',
      input: {
        prompt: 'animate', providerId: 'video-provider', modelId: 'video-model',
        duration: 8, firstFrameImageUrl: '/uploads/first.png',
      },
    })).resolves.toEqual({ kind: 'accepted', taskIds: ['video-task-1'], status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5123/api/video/generate');
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: 'animate', providerId: 'video-provider', model: 'video-model',
      duration: 8, imageUrl: '/uploads/first.png',
    });
  });

  it('returns an explicit rejection only for a completed authoritative response with no task ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false, code: 'MODEL_NOT_AUTHORIZED', error: 'private provider detail',
    }), { status: 403, headers: { 'content-type': 'application/json' } })));

    await expect(submitGatewayImage({
      principal,
      requestId: 'req_12345678',
      gatewayRequestId: 'gwreq_1',
      input: { prompt: 'draw', providerId: 'provider-1', modelId: 'model-1' },
    })).resolves.toEqual({
      kind: 'rejected',
      taskIds: [],
      code: 'GATEWAY_INVALID_REQUEST',
      status: 403,
      retryable: false,
      rejectionCode: 'MODEL_NOT_AUTHORIZED',
    });
  });

  it.each([
    new Error('connect ECONNREFUSED internal-secret'),
    Object.assign(new Error('timed out provider-key'), { name: 'TimeoutError' }),
  ])('maps ambiguous transport failure to a stable unavailable error', async (failure) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    await expect(submitGatewayImage({
      principal,
      requestId: 'req_12345678',
      gatewayRequestId: 'gwreq_1',
      input: { prompt: 'draw', providerId: 'provider-1', modelId: 'model-1' },
    })).rejects.toMatchObject({
      code: 'GATEWAY_INTERNAL_UNAVAILABLE',
      status: 503,
      retryable: true,
      message: 'Media gateway internal submission is unavailable',
    });
  });

  it('treats an unreadable authoritative response as ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    })));

    await expect(submitGatewayVideo({
      principal,
      requestId: 'req_12345678',
      gatewayRequestId: 'gwreq_2',
      input: { prompt: 'animate', providerId: 'provider-1', modelId: 'model-1' },
    })).rejects.toMatchObject({
      code: 'GATEWAY_INTERNAL_UNAVAILABLE',
      status: 503,
      retryable: true,
    });
  });
});
