import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  source: 'internal' as 'cookie' | 'desktop-token' | 'internal',
  imageProvider: {
    id: 'image-provider', name: 'Image provider', displayName: 'Image provider',
    type: 'image', modelType: 'image', apiKey: 'provider-key',
    baseUrl: 'https://provider.example', selectedModels: ['Exact::Image', 'Image'],
    isEnabled: true, createdAt: 1, updatedAt: 1,
  },
  videoProvider: {
    id: 'video-provider', name: 'Video provider', displayName: 'Video provider',
    type: 'video', modelType: 'video', apiKey: 'provider-key',
    baseUrl: 'https://provider.example', selectedModels: ['Exact::Video'],
    isEnabled: true, createdAt: 1, updatedAt: 1,
  },
  findProviderById: vi.fn(),
  findProviderForModel: vi.fn(),
  findProviderForFeature: vi.fn(),
  recordImageTaskSubmitted: vi.fn(),
  resolveTaskModelForUser: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({
    'x-wujie-internal-user-id': 'user-1',
    'x-wujie-internal-user-role': 'admin',
    'x-wujie-internal-secret': 'signed-secret',
  }),
  requireApiAuthOrReject: vi.fn(async () => ({
    authenticated: true, userId: 'user-1', userRole: 'admin', source: mocks.source,
    user: { id: 'user-1', name: 'Admin', role: 'admin', status: 'active' },
  })),
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: 'user-1', name: 'Admin', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1,
  }),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
  findProviderForModel: mocks.findProviderForModel,
  findProviderForFeature: mocks.findProviderForFeature,
  findAllProvidersForType: vi.fn().mockResolvedValue([
    { provider: mocks.imageProvider, models: ['Exact::Image', 'Image'] },
  ]),
  normalizeApiBaseUrl: (value: string) => value.replace(/\/$/, ''),
}));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: vi.fn() }));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: vi.fn().mockResolvedValue(0),
  checkCredits: vi.fn().mockResolvedValue({ sufficient: true, balance: 100 }),
  consumeCredits: vi.fn().mockResolvedValue({ success: true, cost: 0 }),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock('@/lib/task-core/model-catalog', () => ({
  resolveTaskModelForUser: mocks.resolveTaskModelForUser,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  recordImageTaskSubmitted: mocks.recordImageTaskSubmitted,
  recordImageTaskTerminal: vi.fn(),
  recordVideoTaskSubmitted: vi.fn(),
  recordVideoTaskRemotePolling: vi.fn(),
}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: vi.fn(), registerTaskAbortController: vi.fn(),
  unregisterTaskAbortController: vi.fn(), updateTaskProgress: vi.fn(),
  isTaskCancelled: vi.fn().mockReturnValue(false), getTaskInfo: vi.fn(),
}));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: vi.fn().mockResolvedValue({ charged: true, creditCost: 0 }),
  claimCloudTaskLease: vi.fn(), completeCloudTask: vi.fn(), getCloudTaskForUser: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(), releaseCloudTaskLease: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(), updateCloudTask: vi.fn(),
}));
vi.mock('@/lib/runtime-settings', () => ({
  getRuntimeSettings: vi.fn().mockResolvedValue({
    videoGenerationEnabled: true, maxVideoDuration: 60,
  }),
}));

import { POST as generateImage } from '@/app/api/generate/route';
import { POST as generateVideo } from '@/app/api/video/generate/route';
import { trustedGatewayContext } from '@/lib/media-gateway/internal-client';

const gatewayHeaders = {
  'content-type': 'application/json',
  'idempotency-key': 'gwreq_1',
  'x-wujie-source-channel': 'gateway',
  'x-wujie-gateway-request-id': 'gwreq_1',
  'x-wujie-gateway-key-id': 'gwkey_1',
  'x-wujie-agent-strict-routing': 'true',
};

function imageRequest(model = 'Exact::Image'): Request {
  return new Request('http://localhost/api/generate', {
    method: 'POST', headers: gatewayHeaders,
    body: JSON.stringify({
      prompt: 'test image', model, providerId: 'image-provider',
      submitOnly: true, outputCount: 1,
    }),
  });
}

function videoRequest(providerId = 'video-provider'): Request {
  return new Request('http://localhost/api/video/generate', {
    method: 'POST', headers: gatewayHeaders,
    body: JSON.stringify({
      prompt: 'test video', model: 'Exact::Video', providerId, duration: 5,
    }),
  });
}

describe('trusted gateway source context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.source = 'internal';
    mocks.findProviderById.mockImplementation(async (id: string) => (
      id === 'image-provider' ? mocks.imageProvider
        : id === 'video-provider' ? mocks.videoProvider : null
    ));
    mocks.findProviderForModel.mockResolvedValue(mocks.videoProvider);
    mocks.findProviderForFeature.mockResolvedValue(mocks.videoProvider);
    mocks.recordImageTaskSubmitted.mockResolvedValue(true);
    mocks.resolveTaskModelForUser.mockImplementation(async (providerId: string, modelId: string) => ({
      providerId, modelId, kind: providerId === 'video-provider' ? 'video' : 'image',
      sourceType: providerId === 'video-provider' ? 'video' : 'image',
      protocol: 'openai', executionMode: 'async', allowedRatios: ['1:1', '16:9'],
      allowedSizes: [], qualityOptions: [], maxOutputs: 4, supportsReferenceImages: true,
      supportsMask: false, supportedOperations: ['text-to-image', 'text-to-video'],
      outputKinds: ['png', 'mp4'], capabilitySources: {},
    }));
  });

  it('ignores gateway headers from cookie callers and accepts them only for internal auth', () => {
    const forgedHeaders = new Headers(gatewayHeaders);
    expect(trustedGatewayContext('cookie', forgedHeaders)).toBeUndefined();
    expect(trustedGatewayContext('desktop-token', forgedHeaders)).toBeUndefined();
    expect(trustedGatewayContext('internal', forgedHeaders)).toEqual({
      sourceChannel: 'gateway', gatewayRequestId: 'gwreq_1', gatewayKeyId: 'gwkey_1',
    });
  });

  it('sanitizes diagnostic ids instead of persisting arbitrary header content', () => {
    const headers = new Headers(gatewayHeaders);
    headers.set('x-wujie-gateway-request-id', 'invalid/diagnostic@host');
    headers.set('x-wujie-gateway-key-id', 'gwkey_1,forged');
    expect(trustedGatewayContext('internal', headers)).toEqual({ sourceChannel: 'gateway' });
  });

  it.each(['cookie', 'desktop-token'] as const)(
    'does not persist forged gateway metadata for an authenticated %s image request',
    async (source) => {
      mocks.source = source;
      const response = await generateImage(imageRequest() as never);

      expect(response.status).toBe(200);
      const submitted = mocks.recordImageTaskSubmitted.mock.calls[0]?.[0];
      expect(submitted?.submissionPayload).not.toHaveProperty('sourceChannel');
      expect(submitted?.submissionPayload).not.toHaveProperty('gatewayRequestId');
      expect(submitted?.submissionPayload).not.toHaveProperty('gatewayKeyId');
    },
  );

  it('persists sanitized gateway metadata for an internal-authenticated image request', async () => {
    const response = await generateImage(imageRequest() as never);

    expect(response.status).toBe(200);
    expect(mocks.recordImageTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      submissionPayload: expect.objectContaining({
        sourceChannel: 'gateway', gatewayRequestId: 'gwreq_1', gatewayKeyId: 'gwkey_1',
      }),
    }));
  });

  it('does not discover a fallback video provider for trusted gateway context', async () => {
    const response = await generateVideo(videoRequest('missing-provider') as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false, code: 'MODEL_PROVIDER_MISMATCH', retryable: false,
    });
    expect(mocks.findProviderForModel).not.toHaveBeenCalled();
    expect(mocks.findProviderForFeature).not.toHaveBeenCalled();
  });

  it('rejects model canonicalization for trusted video context', async () => {
    mocks.resolveTaskModelForUser.mockResolvedValueOnce({
      providerId: 'video-provider', modelId: 'exact::video',
    });
    const response = await generateVideo(videoRequest() as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false, code: 'MODEL_PROVIDER_MISMATCH', retryable: false,
    });
  });

  it('rejects an image model whose exact case is not configured', async () => {
    const response = await generateImage(imageRequest('exact::image') as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false, code: 'MODEL_PROVIDER_MISMATCH', retryable: false,
    });
    expect(mocks.recordImageTaskSubmitted).not.toHaveBeenCalled();
  });
});
