import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

const mocks = vi.hoisted(() => ({
  getApiProviders: vi.fn(),
  listManagedUsers: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
  inferModelType: (_modelId: string, fallback: string) => fallback,
}));
vi.mock('@/lib/server-auth', () => ({
  listManagedUsers: mocks.listManagedUsers,
}));

import { resolveTaskModel } from '@/lib/task-core/model-catalog';

function createProvider(overrides: Partial<ApiProvider> & Pick<ApiProvider, 'id' | 'type'>): ApiProvider {
  const { id, type, ...rest } = overrides;
  return {
    id,
    name: id,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    isEnabled: true,
    type,
    modelType: type,
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  };
}

function createUser(overrides: Partial<User> & Pick<User, 'id'>): User {
  const { id, ...rest } = overrides;
  return {
    id,
    name: id,
    role: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  };
}

describe('task model catalog', () => {
  beforeEach(() => {
    mocks.getApiProviders.mockResolvedValue([
      createProvider({
        id: 'provider-a',
        type: 'image',
        baseUrl: 'https://api.apimart.ai',
        selectedModels: ['gpt-image-1', 'shared-image'],
        discoveredModels: [
          { id: 'gpt-image-1', name: 'GPT Image', providerId: 'provider-a', type: 'image' },
          { id: 'shared-image', name: 'Shared Image A', providerId: 'provider-a', type: 'image' },
        ],
        advancedParams: {
          taskModelCapabilities: JSON.stringify({
            'gpt-image-1': {
              providerId: 'wrong-provider',
              modelId: 'wrong-model',
              allowedRatios: ['1:1', '16:9'],
              maxOutputs: 2,
              supportsMask: false,
            },
          }),
        },
      }),
      createProvider({
        id: 'provider-b',
        type: 'image',
        selectedModels: ['dall-e-3', 'shared-image'],
        discoveredModels: [
          { id: 'dall-e-3', name: 'DALL-E 3', providerId: 'provider-b', type: 'image' },
          { id: 'shared-image', name: 'Shared Image B', providerId: 'provider-b', type: 'image' },
        ],
      }),
      createProvider({
        id: 'video-provider',
        type: 'video',
        baseUrl: 'https://dashscope.aliyuncs.com',
        selectedModels: ['kling-v3-omni-video-generation'],
        discoveredModels: [
          {
            id: 'kling-v3-omni-video-generation',
            name: 'Kling V3 Omni',
            providerId: 'video-provider',
            type: 'video',
          },
        ],
      }),
    ]);
    mocks.listManagedUsers.mockResolvedValue([
      createUser({
        id: 'user-a',
        imageModels: ['provider-a::shared-image'],
        apiPermissions: {
          image: true,
          chat: true,
          threeD: true,
          imageEdit: true,
          vectorize: true,
          vlm: true,
          layer: true,
          video: true,
          upscaler: true,
          removebg: true,
          audio: true,
        },
      }),
      createUser({ id: 'legacy-user', imageModels: ['shared-image'] }),
      createUser({ id: 'admin-a', role: 'admin' }),
    ]);
  });

  it('uses existing image inference and only applies explicit per-model admin overrides', async () => {
    const descriptor = await resolveTaskModel('provider-a', 'gpt-image-1', 'admin-a');

    expect(descriptor).toEqual({
      providerId: 'provider-a',
      modelId: 'gpt-image-1',
      kind: 'image',
      protocol: 'apimart',
      executionMode: 'async',
      allowedRatios: ['1:1', '16:9'],
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: ['auto', 'low', 'medium', 'high'],
      maxOutputs: 2,
      supportsReferenceImages: true,
      supportsMask: false,
      outputKinds: ['png', 'jpeg', 'webp'],
    });
  });

  it('keeps default image size, quality, reference, mask, execution, and output inference', async () => {
    const descriptor = await resolveTaskModel('provider-b', 'dall-e-3', 'admin-a');

    expect(descriptor).toEqual({
      providerId: 'provider-b',
      modelId: 'dall-e-3',
      kind: 'image',
      protocol: 'openai',
      executionMode: 'sync',
      allowedRatios: expect.arrayContaining(['1:1', '16:9', '9:16']),
      allowedSizes: ['1024x1024', '1792x1024', '1024x1792'],
      qualityOptions: ['standard', 'hd'],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      outputKinds: ['png'],
    });
  });

  it('reuses video capabilities for duration, ratios, sizes, references, and async execution', async () => {
    const descriptor = await resolveTaskModel(
      'video-provider',
      'kling-v3-omni-video-generation',
      'admin-a',
    );

    expect(descriptor).toEqual({
      providerId: 'video-provider',
      modelId: 'kling-v3-omni-video-generation',
      kind: 'video',
      protocol: 'dashscope',
      executionMode: 'async',
      allowedRatios: ['1:1', '4:3', '16:9', '9:16'],
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: ['std', 'pro'],
      maxOutputs: 1,
      maxDurationSeconds: 30,
      supportsReferenceImages: true,
      supportsMask: false,
      outputKinds: ['mp4'],
    });
  });

  it('requires an exact provider and model pair before applying user authorization', async () => {
    await expect(resolveTaskModel('provider-a', 'shared-image', 'user-a')).resolves.toMatchObject({
      providerId: 'provider-a',
      modelId: 'shared-image',
    });
    await expect(resolveTaskModel('provider-b', 'shared-image', 'user-a')).rejects.toThrow(
      'not authorized',
    );
    await expect(resolveTaskModel('provider-a', 'shared-image', 'legacy-user')).rejects.toThrow(
      'not authorized',
    );
    await expect(resolveTaskModel('provider-a', 'dall-e-3', 'admin-a')).rejects.toThrow(
      'not configured',
    );
  });
});
