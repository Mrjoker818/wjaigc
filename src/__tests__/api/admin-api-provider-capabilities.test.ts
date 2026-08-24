import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addApiProvider: vi.fn(),
  deleteApiProvider: vi.fn(),
  discoverModelsForCredentials: vi.fn(),
  getApiProviders: vi.fn(),
  getPublicApiProviders: vi.fn(),
  refreshApiProvider: vi.fn(),
  reorderProviders: vi.fn(),
    sanitizeAdminProvider: vi.fn((provider: Record<string, unknown>) => {
      const editableProvider = { ...provider };
      delete editableProvider.apiKey;
      delete editableProvider.balanceUsername;
      delete editableProvider.balancePassword;
      return editableProvider;
    }),
  sanitizeProvider: vi.fn((provider) => provider),
  updateApiProvider: vi.fn(),
  requireAdminUser: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => mocks);
vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));

import { GET, POST } from '@/app/api/admin/apis/route';

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/apis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin provider capability updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1' });
  });

  it('returns editable advanced parameters to administrators without leaking the API key', async () => {
    mocks.getApiProviders.mockResolvedValue([{
      id: 'provider-a',
      name: 'Provider A',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'server-secret',
      isEnabled: true,
      type: 'image',
      modelType: 'image',
      createdAt: 1,
      updatedAt: 1,
      advancedParams: {
        compatProfile: 'pearapi',
        customHeader: 'x-client',
        taskModelCapabilities: JSON.stringify({ version: 1, models: { 'gpt-image-2': { maxOutputs: 2 } } }),
      },
    }]);

    const response = await GET(request({}) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.providers[0]).toMatchObject({
      id: 'provider-a',
      advancedParams: expect.objectContaining({
        compatProfile: 'pearapi',
        customHeader: 'x-client',
      }),
    });
    expect(payload.providers[0]).not.toHaveProperty('apiKey');
    expect(mocks.getPublicApiProviders).not.toHaveBeenCalled();
  });

  it('rejects malformed capability data before invoking persistence', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1' });

    const response = await POST(request({
      action: 'update',
      providerId: 'provider-a',
      updates: {
        advancedParams: {
          compatProfile: 'pearapi',
          taskModelCapabilities: JSON.stringify({
            version: 1,
            models: { 'gpt-image-2': { maxOutputs: 99 } },
          }),
        },
      },
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'INVALID_MODEL_CAPABILITIES',
    });
    expect(mocks.updateApiProvider).not.toHaveBeenCalled();
  });

  it('serializes valid v1 overrides canonically, preserves compat profile, and omits an empty key update', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1' });
    mocks.updateApiProvider.mockResolvedValue({ id: 'provider-a' });

    const response = await POST(request({
      action: 'update',
      providerId: 'provider-a',
      updates: {
        apiKey: '',
        advancedParams: {
          compatProfile: 'pearapi',
          taskModelCapabilities: JSON.stringify({
            version: 1,
            models: {
              'video-a': { maxDurationSeconds: 10, allowedDurationsSeconds: [5, 10] },
              'gpt-image-2': { maxOutputs: 4, allowedRatios: ['1:1', '16:9'] },
            },
          }),
        },
      },
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.updateApiProvider).toHaveBeenCalledWith('provider-a', {
      advancedParams: {
        compatProfile: 'pearapi',
        taskModelCapabilities: JSON.stringify({
          version: 1,
          models: {
            'gpt-image-2': { allowedRatios: ['1:1', '16:9'], maxOutputs: 4 },
            'video-a': { allowedDurationsSeconds: [5, 10], maxDurationSeconds: 10 },
          },
        }),
      },
    });
  });

  it('accepts an existing JSON-string advanced parameter payload and canonicalizes its capabilities', async () => {
    mocks.updateApiProvider.mockResolvedValue({ id: 'provider-a' });

    const response = await POST(request({
      action: 'update',
      providerId: 'provider-a',
      updates: {
        advancedParams: JSON.stringify({
          compatProfile: 'pearapi',
          taskModelCapabilities: JSON.stringify({ version: 1, models: { 'gpt-image-2': { maxOutputs: 2 } } }),
        }),
      },
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.updateApiProvider).toHaveBeenCalledWith('provider-a', {
      advancedParams: {
        compatProfile: 'pearapi',
        taskModelCapabilities: JSON.stringify({ version: 1, models: { 'gpt-image-2': { maxOutputs: 2 } } }),
      },
    });
  });

  it('rejects malformed capabilities supplied through an add JSON-string payload before persistence', async () => {
    const response = await POST(request({
      name: 'Provider A',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'server-secret',
      modelType: 'image',
      advancedParams: JSON.stringify({
        compatProfile: 'pearapi',
        taskModelCapabilities: JSON.stringify({ version: 1, models: { 'gpt-image-2': { maxOutputs: 99 } } }),
      }),
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_MODEL_CAPABILITIES' });
    expect(mocks.addApiProvider).not.toHaveBeenCalled();
  });

  it('rejects non-object JSON-string advanced parameters instead of clearing persisted values', async () => {
    const response = await POST(request({
      action: 'update',
      providerId: 'provider-a',
      updates: {
        advancedParams: 'null',
      },
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_MODEL_CAPABILITIES' });
    expect(mocks.updateApiProvider).not.toHaveBeenCalled();
  });
});
