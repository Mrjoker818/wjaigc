import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { after, NextRequest } from 'next/server';
import { calculateConfiguredCreditCost } from '@/lib/credits';

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
  recordVideoTaskSubmitted: vi.fn(),
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
  recordVideoTaskSubmitted: mocks.recordVideoTaskSubmitted,
  recordVideoTaskRemotePolling: vi.fn(),
}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: vi.fn(), registerTaskAbortController: vi.fn(),
  unregisterTaskAbortController: vi.fn(), updateTaskProgress: vi.fn(),
  isTaskCancelled: vi.fn().mockReturnValue(false), getTaskInfo: vi.fn(),
}));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/cloud-task-storage', async (importOriginal) => ({
  CloudTaskAdmissionError: (await importOriginal<typeof import('@/lib/cloud-task-storage')>()).CloudTaskAdmissionError,
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

function videoRequest(providerId = 'video-provider'): NextRequest {
  return new NextRequest('http://localhost/api/video/generate', {
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
    mocks.recordVideoTaskSubmitted.mockResolvedValue(undefined);
    mocks.resolveTaskModelForUser.mockImplementation(async (providerId: string, modelId: string) => ({
      providerId, modelId, kind: providerId === 'video-provider' ? 'video' : 'image',
      sourceType: providerId === 'video-provider' ? 'video' : 'image',
      protocol: 'openai', executionMode: 'async', allowedRatios: ['1:1', '16:9'],
      allowedSizes: [], qualityOptions: [], maxOutputs: 4, supportsReferenceImages: true,
      supportsMask: false, allowedDurationsSeconds: [5],
      supportedOperations: ['text-to-image', 'text-to-video'],
      outputKinds: ['png', 'mp4'], capabilitySources: {},
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it.each(['cookie', 'desktop-token'] as const)(
    'does not persist forged gateway metadata for an authenticated %s video request',
    async (source) => {
      mocks.source = source;
      const providerFetch = vi.fn();
      vi.stubGlobal('fetch', providerFetch);

      const response = await generateVideo(videoRequest() as never);

      expect(response.status).toBe(200);
      const submitted = mocks.recordVideoTaskSubmitted.mock.calls[0]?.[0];
      expect(submitted?.submissionPayload).not.toHaveProperty('sourceChannel');
      expect(submitted?.submissionPayload).not.toHaveProperty('gatewayRequestId');
      expect(submitted?.submissionPayload).not.toHaveProperty('gatewayKeyId');
      expect(providerFetch).not.toHaveBeenCalled();
    },
  );

  it('persists sanitized gateway metadata for an internal-authenticated video request', async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);

    const response = await generateVideo(videoRequest() as never);

    expect(response.status).toBe(200);
    expect(mocks.recordVideoTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      submissionPayload: expect.objectContaining({
        sourceChannel: 'gateway', gatewayRequestId: 'gwreq_1', gatewayKeyId: 'gwkey_1',
      }),
    }));
    expect(providerFetch).not.toHaveBeenCalled();
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

describe('provider video admission', () => {
  const model = 'doubao-seedance-2-0-mini-260615';
  const imageUrl = 'https://example.com/first.png';
  const secondImage = 'https://example.com/second.png';
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

  function request(input: Record<string, unknown> = {}) {
    return new NextRequest('http://localhost/api/video/generate', {
      method: 'POST', headers: gatewayHeaders,
      body: JSON.stringify({ prompt: 'test video', providerId: 'video-provider', model, useDirector: false, ...input }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.source = 'internal';
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('unexpected fetch'));
    vi.stubGlobal('fetch', fetcher);
    mocks.findProviderById.mockResolvedValue({ ...mocks.videoProvider, baseUrl: 'https://api.pearapi.ai' });
    // Deliberately allow extra operations/durations to exercise the Pear boundary even with admin overrides.
    mocks.resolveTaskModelForUser.mockImplementation(async (providerId: string, modelId: string) => ({
      providerId, modelId, kind: 'video', protocol: 'pearapi-video', allowedRatios: ['16:9'], allowedSizes: [],
      allowedDurationsSeconds: [5, 6, 8, 10], supportsReferenceImages: true, maxReferenceImages: 20,
      supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame', 'multi-reference'],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [{ model: 'hailuo-2.3', duration: 6 }, 'operation'],
    [{ model: 'hailuo-2.3', imageUrl, duration: 8 }, 'duration'],
    [{ imageUrl, lastFrameImageUrl: secondImage }, 'operation'],
    [{ referenceImages: [imageUrl] }, 'referenceImages'],
    [{ characterReferences: [imageUrl, secondImage] }, 'characterReferences'],
    [{ videoUrl: 'https://example.com/source.mp4' }, 'operation'],
  ] as const)('rejects %j before pricing or scheduling', async (input, field) => {
    const response = await generateVideo(request(input));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'MODEL_CAPABILITY_MISMATCH', retryable: false, details: { field },
    });
    expect(calculateConfiguredCreditCost).not.toHaveBeenCalled();
    expect(mocks.recordVideoTaskSubmitted).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails admission if the requested image cannot be resolved', async () => {
    fetcher.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    const response = await generateVideo(request({ imageUrl: '/uploads/missing.png' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'MODEL_CAPABILITY_MISMATCH', retryable: false });
    expect(calculateConfiguredCreditCost).not.toHaveBeenCalled();
    expect(mocks.recordVideoTaskSubmitted).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ model: 'hailuo-2.3', imageUrl }, 6, 'image2video', [imageUrl]],
    [{ duration: '10', referenceImages: [imageUrl, secondImage] }, 10, 'reference2video', [imageUrl, secondImage]],
  ] as const)('uses the admitted seconds and mode for %j', async (input, duration, generationMode, urls) => {
    fetcher.mockResolvedValueOnce(Response.json({ id: 'synthetic-remote', status: 'queued' }));
    const response = await generateVideo(request(input));
    expect(response.status).toBe(200);
    expect(calculateConfiguredCreditCost).toHaveBeenCalledWith('video_generate', 'model' in input ? input.model : model, {
      providerId: 'video-provider', durationSeconds: duration,
    });
    expect(mocks.recordVideoTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      submissionPayload: expect.objectContaining({ duration }),
    }));
    await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.pearapi.ai/v1/videos/generations', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      duration, generation_mode: generationMode,
      reference_contents: urls.map(media_url => ({ type: 'image', media_url })),
    });
  });

  it('admits APIMart Omni at its nominal ten seconds and omits the wire duration', async () => {
    const omni = 'gemini-omni-flash-preview';
    mocks.findProviderById.mockResolvedValue({ ...mocks.videoProvider, baseUrl: 'https://api.apib.ai' });
    const rejected = await generateVideo(request({ model: omni, duration: 5 }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: 'MODEL_CAPABILITY_MISMATCH', details: { field: 'duration' } });
    expect(calculateConfiguredCreditCost).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(Response.json({ code: 200, data: [{ task_id: 'synthetic-remote' }] }));
    const accepted = await generateVideo(request({ model: omni }));
    expect(accepted.status).toBe(200);
    expect(calculateConfiguredCreditCost).toHaveBeenCalledWith('video_generate', omni, {
      providerId: 'video-provider', durationSeconds: 10,
    });
    await (vi.mocked(after).mock.calls[0]?.[0] as () => Promise<void>)();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.apib.ai/v1/videos/generations', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty('duration');
  });
});


it('keeps the real admission constructor and derived error contract under the partial storage mock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cloud-task-storage')>('@/lib/cloud-task-storage');
  const mocked = await import('@/lib/cloud-task-storage');
  const { SketchAdmissionError } = await import('@/lib/sketch-to-code/admission');
  expect(mocked.CloudTaskAdmissionError).toBe(actual.CloudTaskAdmissionError);
  const error = new SketchAdmissionError('SYNTHETIC_PROJECT_DENIED', 403);
  expect(error).toBeInstanceOf(actual.CloudTaskAdmissionError);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name: 'SketchAdmissionError', code: 'SYNTHETIC_PROJECT_DENIED', status: 403, message: 'SYNTHETIC_PROJECT_DENIED' });
  expect(new Error('ordinary')).not.toBeInstanceOf(actual.CloudTaskAdmissionError);
});
