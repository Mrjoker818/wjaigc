import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const persistence = vi.hoisted(() => ({
  provider: {
    id: 'provider-exact',
    name: 'Exact provider',
    displayName: 'Exact provider',
    type: 'image' as const,
    modelType: 'image' as const,
    apiKey: 'provider-key',
    baseUrl: 'https://provider.example',
    selectedModels: ['Exact::Model'],
    isEnabled: true,
    createdAt: 1,
    updatedAt: 1,
  },
  recordImageTaskSubmitted: vi.fn(),
  recordImageTaskTerminal: vi.fn(),
  registerTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  requireApiAuthOrReject: vi.fn(),
  consumeCredits: vi.fn(),
  resolveTaskModelForUser: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: vi.fn().mockResolvedValue({
    'x-wujie-internal-user-id': 'user-1',
    'x-wujie-internal-user-role': 'admin',
    'x-wujie-internal-secret': 'signed-secret',
  }),
  requireApiAuthOrReject: persistence.requireApiAuthOrReject,
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: 'user-1', name: 'Admin', role: 'admin', status: 'active', createdAt: 1, updatedAt: 1,
  }),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: vi.fn().mockResolvedValue(persistence.provider),
  findProviderForModel: vi.fn().mockResolvedValue(persistence.provider),
  findAllProvidersForType: vi.fn().mockResolvedValue([{ provider: persistence.provider, models: ['Exact::Model'] }]),
  normalizeApiBaseUrl: (value: string) => value.replace(/\/$/, ''),
}));
vi.mock('@/lib/server-user-storage', () => ({ appendUserJsonl: vi.fn() }));
vi.mock('@/lib/credits', () => ({
  calculateConfiguredCreditCost: vi.fn().mockResolvedValue(0),
  checkCredits: vi.fn().mockResolvedValue({ sufficient: true, balance: 100 }),
  consumeCredits: persistence.consumeCredits,
}));
vi.mock('@/lib/task-core/model-catalog', () => ({
  resolveTaskModelForUser: persistence.resolveTaskModelForUser,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  recordImageTaskSubmitted: persistence.recordImageTaskSubmitted,
  recordImageTaskTerminal: persistence.recordImageTaskTerminal,
}));
vi.mock('@/lib/task-registry', () => ({
  registerTask: persistence.registerTask,
  updateTaskProgress: persistence.updateTaskProgress,
  isTaskCancelled: vi.fn().mockReturnValue(false),
  getTaskInfo: vi.fn(),
}));
vi.mock('@/lib/s3-storage', () => ({ persistRemoteImage: vi.fn(async (url: string) => url) }));
vi.mock('@/lib/cloud-task-storage', () => ({
  chargeCloudTaskCredits: vi.fn(),
  getCloudTaskForUserByIdempotencyKey: vi.fn(),
  terminateCloudTaskAndRefund: vi.fn(),
  updateCloudTask: vi.fn(),
}));

import { POST as generate } from '@/app/api/generate/route';
import { submitStrictAgentGeneration } from '@/lib/agent-runtime/generate-image-adapter';
import { ModelCapabilityError } from '@/lib/task-core/model-capability-contract';

describe('real Agent generate_image provider path', () => {
  it('preserves a provider parameter rejection as HTTP 400 instead of a retryable 500', async () => {
    const externalSubmit = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'invalid_quality', message: 'This model only supports auto, low, medium or high quality (got: 1K).' },
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', externalSubmit);
    let status = 0;
    const result = await submitStrictAgentGeneration({
      userId: 'user-1', userRole: 'admin', prompt: 'test image', aspectRatio: '1:1',
      model: 'Exact::Model', providerId: 'provider-exact', idempotencyKey: 'agent-provider:quality-error',
      fetchImpl: async (_url, init) => {
        const response = await generate(new Request('http://localhost/api/generate', init) as never);
        status = response.status;
        return response;
      },
      extraBody: { _skipCredits: true, _skipCloudTaskPersistence: true },
    });
    expect(status).toBe(400);
    expect(result).toMatchObject({ success: false, providerStatus: 400, providerCode: 'invalid_quality', retryable: false });
    expect(externalSubmit).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    persistence.provider.selectedModels = ['Exact::Model'];
    persistence.consumeCredits.mockResolvedValue({ success: true, cost: 0 });
    persistence.resolveTaskModelForUser.mockImplementation(async (
      providerId: string,
      modelId: string,
    ) => ({
      providerId,
      modelId,
      kind: 'image',
      sourceType: 'image',
      protocol: 'openai',
      executionMode: 'sync',
      allowedRatios: ['1:1'],
      allowedSizes: [],
      qualityOptions: ['high'],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      supportedOperations: ['text-to-image'],
      outputKinds: ['png'],
      capabilitySources: {},
    }));
    persistence.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'admin',
      source: 'internal',
      user: { id: 'user-1', role: 'admin' },
    });
  });

  it('rejects unsupported capability selections before billing, persistence, or provider fetch', async () => {
    const externalSubmit = vi.fn();
    vi.stubGlobal('fetch', externalSubmit);

    const result = await submitStrictAgentGeneration({
      userId: 'user-1',
      userRole: 'admin',
      prompt: 'Unsupported wide image',
      aspectRatio: '16:9',
      model: 'Exact::Model',
      providerId: 'provider-exact',
      idempotencyKey: 'agent-provider:stable:unsupported-ratio',
      fetchImpl: async (_url, init) => generate(new Request('http://localhost/api/generate', init) as never),
      extraBody: { _skipCredits: true, _skipCloudTaskPersistence: true },
    });

    expect(result).toMatchObject({
      success: false,
      code: 'MODEL_CAPABILITY_MISMATCH',
      retryable: false,
      details: {
        providerId: 'provider-exact',
        modelId: 'Exact::Model',
        field: 'aspectRatio',
      },
    });
    expect(persistence.consumeCredits).not.toHaveBeenCalled();
    expect(persistence.recordImageTaskSubmitted).not.toHaveBeenCalled();
    expect(persistence.registerTask).not.toHaveBeenCalled();
    expect(externalSubmit).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous bare authorization before billing or durable task persistence', async () => {
    persistence.provider.selectedModels = ['shared-model'];
    persistence.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'user',
      source: 'session',
      user: { id: 'user-1', role: 'user', imageModels: ['shared-model'] },
    });
    persistence.resolveTaskModelForUser.mockRejectedValue(new ModelCapabilityError(
      'MODEL_NOT_AUTHORIZED',
      'Model authorization migration required for shared-model: ambiguous',
      { providerId: 'provider-exact', modelId: 'shared-model', reason: 'ambiguous' },
    ));
    const externalSubmit = vi.fn();
    vi.stubGlobal('fetch', externalSubmit);

    const response = await generate(new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Must reject ambiguous legacy authorization',
        aspectRatio: '1:1',
        model: 'shared-model',
        providerId: 'provider-exact',
      }),
    }) as never);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'MODEL_NOT_AUTHORIZED',
      retryable: false,
    });
    expect(persistence.consumeCredits).not.toHaveBeenCalled();
    expect(persistence.recordImageTaskSubmitted).not.toHaveBeenCalled();
    expect(persistence.registerTask).not.toHaveBeenCalled();
    expect(externalSubmit).not.toHaveBeenCalled();
  });

  it('preserves the exact model and one stable idempotency key through /api/generate', async () => {
    const externalSubmit = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe('Exact::Model');
      expect(body.idempotency_key).toBe('agent-provider:stable:generate_image:0');
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(
        'agent-provider:stable:generate_image:0',
      );
      return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', externalSubmit);

    const result = await submitStrictAgentGeneration({
      userId: 'user-1',
      userRole: 'admin',
      prompt: 'Create one exact image',
      aspectRatio: '1:1',
      model: 'Exact::Model',
      providerId: 'provider-exact',
      idempotencyKey: 'agent-provider:stable:generate_image:0',
      fetchImpl: async (_url, init) => generate(new Request('http://localhost/api/generate', init) as never),
      extraBody: { _skipCredits: true, _skipCloudTaskPersistence: true },
    });

    expect(result).toMatchObject({ success: true });
    expect(externalSubmit).toHaveBeenCalledTimes(1);
  });

  it('rejects an exact model mismatch before provider or task creation', async () => {
    const externalSubmit = vi.fn();
    vi.stubGlobal('fetch', externalSubmit);

    const result = await submitStrictAgentGeneration({
      userId: 'user-1',
      userRole: 'admin',
      prompt: 'Must fail closed',
      aspectRatio: '1:1',
      model: 'Exact::model',
      providerId: 'provider-exact',
      idempotencyKey: 'agent-provider:stable:mismatch',
      fetchImpl: async (_url, init) => generate(new Request('http://localhost/api/generate', init) as never),
      extraBody: { _skipCredits: true, _skipCloudTaskPersistence: true },
    });

    expect(result).toMatchObject({ success: false, code: 'MODEL_PROVIDER_MISMATCH' });
    expect(externalSubmit).not.toHaveBeenCalled();
    expect(persistence.recordImageTaskSubmitted).not.toHaveBeenCalled();
    expect(persistence.registerTask).not.toHaveBeenCalled();
  });

  it('does not retry or fall back after the strict external submit is rejected', async () => {
    const externalSubmit = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'provider rejected once' },
    }), { status: 500, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', externalSubmit);

    const result = await submitStrictAgentGeneration({
      userId: 'user-1',
      userRole: 'admin',
      prompt: 'One submit only',
      aspectRatio: '1:1',
      model: 'Exact::Model',
      providerId: 'provider-exact',
      idempotencyKey: 'agent-provider:stable:reject-once',
      fetchImpl: async (_url, init) => generate(new Request('http://localhost/api/generate', init) as never),
      extraBody: { _skipCredits: true, _skipCloudTaskPersistence: true },
    });

    expect(result.success).toBe(false);
    expect(externalSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not let a session client forge the strict-routing header', async () => {
    persistence.requireApiAuthOrReject.mockResolvedValue({
      authenticated: true,
      userId: 'user-1',
      userRole: 'admin',
      source: 'session',
      user: { id: 'user-1', role: 'admin' },
    });
    const externalSubmit = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe('Exact::Model');
      expect(body).not.toHaveProperty('idempotency_key');
      expect(new Headers(init?.headers).has('idempotency-key')).toBe(false);
      return new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZQ==' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', externalSubmit);

    const response = await generate(new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wujie-agent-strict-routing': 'true',
        'idempotency-key': 'forged-client-key',
      },
      body: JSON.stringify({
        prompt: 'Forged strict request', model: 'Exact::model', providerId: 'provider-exact',
        _skipCredits: true, _skipCloudTaskPersistence: true,
      }),
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'MODEL_PROVIDER_MISMATCH' });
    expect(externalSubmit).not.toHaveBeenCalled();
  });
});
