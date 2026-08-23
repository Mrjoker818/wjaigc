import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

const mocks = vi.hoisted(() => ({
  getApiProviders: vi.fn(),
  listManagedUsers: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server-api-config')>(),
  getApiProviders: mocks.getApiProviders,
}));
vi.mock('@/lib/server-auth', () => ({
  listManagedUsers: mocks.listManagedUsers,
}));

import {
  resolveTaskModel,
  resolveTaskModelCatalogResult,
  taskModelKey,
} from '@/lib/task-core/model-catalog';

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
              kind: 'chat',
              allowedRatios: [' 1:1 ', '', '16:9', '1:1'],
              maxOutputs: 2,
              supportsMask: false,
            },
            'shared-image': {
              maxOutputs: 999,
              maxDurationSeconds: -1,
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
        advancedParams: {
          taskModelCapabilities: JSON.stringify({
            'dall-e-3': {
              allowedRatios: ['1:1', 42],
              allowedSizes: Array.from({ length: 33 }, (_, index) => `size-${index}`),
              maxOutputs: 2.5,
            },
          }),
        },
      }),
      createProvider({
        id: 'general-provider',
        type: 'universal',
        modelType: 'universal',
        baseUrl: 'https://dashscope.aliyuncs.com',
        selectedModels: ['kling-v3-omni-video-generation'],
        discoveredModels: [
          {
            id: 'kling-v3-omni-video-generation',
            name: 'Kling V3 Omni',
            providerId: 'general-provider',
            type: 'image',
          },
        ],
      }),
      createProvider({
        id: 'vlm-provider',
        type: 'universal',
        modelType: 'universal',
        selectedModels: ['qwen3-vl'],
        discoveredModels: [
          {
            id: 'qwen3-vl',
            name: 'Qwen VLM',
            providerId: 'vlm-provider',
            type: 'chat',
          },
        ],
      }),
      createProvider({
        id: 'chat-provider',
        type: 'chat',
        selectedModels: ['chat-model'],
        discoveredModels: [
          {
            id: 'chat-model',
            name: 'Chat Model',
            providerId: 'chat-provider',
            type: 'chat',
          },
        ],
      }),
      createProvider({
        id: 'layer-provider',
        type: 'layer',
        modelType: 'layer',
        selectedModels: ['stale-layer'],
        discoveredModels: [
          {
            id: 'stale-layer',
            name: 'Stale Layer Type',
            providerId: 'layer-provider',
            type: 'image',
          },
        ],
      }),
      createProvider({
        id: 'inherited-override-provider',
        type: 'image',
        selectedModels: ['gpt-image-1'],
        discoveredModels: [
          {
            id: 'gpt-image-1',
            name: 'Inherited Override',
            providerId: 'inherited-override-provider',
            type: 'image',
          },
        ],
        advancedParams: Object.create({
          taskModelCapabilities: JSON.stringify({
            'gpt-image-1': { supportsMask: false },
          }),
        }) as ApiProvider['advancedParams'],
      }),
      createProvider({
        id: 'unique-provider',
        type: 'image',
        selectedModels: ['unique-image'],
        discoveredModels: [
          {
            id: 'unique-image',
            name: 'Unique Image',
            providerId: 'unique-provider',
            type: 'image',
          },
        ],
      }),
      createProvider({
        id: 'audio-provider',
        type: 'audio',
        selectedModels: ['speech-1'],
        discoveredModels: [
          {
            id: 'speech-1',
            name: 'Speech 1',
            providerId: 'audio-provider',
            type: 'audio',
          },
        ],
      }),
      createProvider({
        id: '302-legacy-provider',
        type: 'upscaler',
        baseUrl: 'https://api.302.ai',
        selectedModels: ['302'],
      }),
      createProvider({
        id: '302-alias-provider',
        type: 'upscaler',
        baseUrl: 'https://api.302.ai',
        selectedModels: ['upscale-v6'],
      }),
      createProvider({
        id: '302-unknown-provider',
        type: 'upscaler',
        baseUrl: 'https://api.302.ai',
        selectedModels: ['custom-upscale'],
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
      createUser({ id: 'unique-legacy-user', imageModels: ['unique-image'] }),
      createUser({ id: 'ambiguous-legacy-user', imageModels: ['shared-image'] }),
      createUser({
        id: 'vlm-selected-user',
        chatModels: ['vlm-provider::qwen3-vl'],
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
      createUser({
        id: 'vlm-unselected-user',
        chatModels: ['chat-provider::chat-model'],
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
      createUser({
        id: '302-exact-alias-user',
        imageModels: ['302-alias-provider::upscale-v6'],
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
      createUser({
        id: '302-bare-alias-user',
        imageModels: ['upscale-v6'],
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
      createUser({
        id: 'layer-denied-user',
        imageModels: ['layer-provider::stale-layer'],
        apiPermissions: {
          image: true,
          chat: true,
          threeD: true,
          imageEdit: true,
          vectorize: true,
          vlm: true,
          layer: false,
          video: true,
          upscaler: true,
          removebg: true,
          audio: true,
        },
      }),
      createUser({ id: 'admin-a', role: 'admin' }),
    ]);
  });

  it('uses existing image inference and only applies explicit per-model admin overrides', async () => {
    const descriptor = await resolveTaskModel('provider-a', 'gpt-image-1', 'admin-a');

    expect(descriptor).toEqual({
      providerId: 'provider-a',
      modelId: 'gpt-image-1',
      kind: 'image',
      sourceType: 'image',
      protocol: 'apimart',
      executionMode: 'async',
      allowedRatios: ['1:1', '16:9'],
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: ['auto', 'low', 'medium', 'high'],
      maxOutputs: 2,
      supportsReferenceImages: true,
      maxReferenceImages: 1,
      supportsMask: false,
      supportedOperations: ['text-to-image', 'image-to-image'],
      outputKinds: ['png', 'jpeg', 'webp'],
      capabilitySources: {
        protocol: 'fallback',
        executionMode: 'fallback',
        allowedRatios: 'admin',
        allowedSizes: 'fallback',
        qualityOptions: 'fallback',
        maxOutputs: 'admin',
        supportsReferenceImages: 'fallback',
        maxReferenceImages: 'fallback',
        supportsMask: 'admin',
        supportedOperations: 'fallback',
        outputKinds: 'fallback',
      },
    });
  });

  it('keeps default image size, quality, reference, mask, execution, and output inference', async () => {
    const descriptor = await resolveTaskModel('provider-b', 'dall-e-3', 'admin-a');

    expect(descriptor).toEqual({
      providerId: 'provider-b',
      modelId: 'dall-e-3',
      kind: 'image',
      sourceType: 'image',
      protocol: 'openai',
      executionMode: 'sync',
      allowedRatios: expect.arrayContaining(['1:1', '16:9', '9:16']),
      allowedSizes: ['1024x1024', '1792x1024', '1024x1792'],
      qualityOptions: ['standard', 'hd'],
      maxOutputs: 1,
      supportsReferenceImages: false,
      supportsMask: false,
      supportedOperations: ['text-to-image'],
      outputKinds: ['png'],
      capabilitySources: {
        protocol: 'fallback',
        executionMode: 'fallback',
        allowedRatios: 'fallback',
        allowedSizes: 'fallback',
        qualityOptions: 'fallback',
        maxOutputs: 'fallback',
        supportsReferenceImages: 'fallback',
        supportsMask: 'fallback',
        supportedOperations: 'fallback',
        outputKinds: 'fallback',
      },
    });
  });

  it('preserves the effective VLM distinction separately from reference-image support', async () => {
    const imageDescriptor = await resolveTaskModel('provider-a', 'gpt-image-1', 'admin-a');
    const vlmDescriptor = await resolveTaskModel('vlm-provider', 'qwen3-vl', 'admin-a');

    expect(imageDescriptor).toMatchObject({
      kind: 'image',
      sourceType: 'image',
      supportsReferenceImages: true,
    });
    expect(vlmDescriptor).toMatchObject({
      kind: 'chat',
      sourceType: 'vlm',
      supportsReferenceImages: true,
    });
  });

  it('rejects an invalid override array or fractional number instead of partially replacing defaults', async () => {
    const descriptor = await resolveTaskModel('provider-b', 'dall-e-3', 'admin-a');

    expect(descriptor.allowedRatios).toEqual(
      expect.arrayContaining(['1:1', '16:9', '9:16']),
    );
    expect(descriptor.allowedSizes).toEqual([
      '1024x1024',
      '1792x1024',
      '1024x1792',
    ]);
    expect(descriptor.maxOutputs).toBe(1);
  });

  it('treats an all-whitespace override array as invalid and keeps inferred defaults', async () => {
    const providers = await mocks.getApiProviders();
    const providerB = providers.find((provider: ApiProvider) => provider.id === 'provider-b');
    if (!providerB) throw new Error('provider-b fixture missing');
    providerB.advancedParams = {
      taskModelCapabilities: JSON.stringify({
        'dall-e-3': {
          allowedSizes: [' ', '\t'],
        },
      }),
    };

    const descriptor = await resolveTaskModel('provider-b', 'dall-e-3', 'admin-a');

    expect(descriptor.allowedSizes).toEqual([
      '1024x1024',
      '1792x1024',
      '1024x1792',
    ]);
  });

  it('reuses video capabilities for duration, ratios, sizes, references, and async execution', async () => {
    const descriptor = await resolveTaskModel(
      'general-provider',
      'kling-v3-omni-video-generation',
      'admin-a',
    );

    expect(descriptor).toMatchObject({
      providerId: 'general-provider',
      modelId: 'kling-v3-omni-video-generation',
      kind: 'video',
      sourceType: 'video',
      protocol: 'dashscope',
      executionMode: 'async',
      allowedRatios: ['1:1', '4:3', '16:9', '9:16'],
      allowedSizes: ['1K', '2K', '4K'],
      qualityOptions: ['std', 'pro'],
      maxOutputs: 1,
      maxDurationSeconds: 30,
      allowedDurationsSeconds: expect.arrayContaining([5, 10, 15]),
      supportedOperations: expect.arrayContaining(['text-to-video', 'image-to-video']),
      supportsReferenceImages: true,
      supportsMask: false,
      outputKinds: ['mp4'],
      capabilitySources: expect.any(Object),
    });
  });

  it('migrates a legacy bare assignment only when the visible provider pair is unique', async () => {
    await expect(resolveTaskModel(
      'unique-provider',
      'unique-image',
      'unique-legacy-user',
    )).resolves.toMatchObject({
      providerId: 'unique-provider',
      modelId: 'unique-image',
    });
  });

  it('rejects ambiguous legacy bare assignments instead of guessing a provider', async () => {
    await expect(resolveTaskModel(
      'provider-a',
      'shared-image',
      'ambiguous-legacy-user',
    )).rejects.toThrow('migration required');
    await expect(resolveTaskModel(
      'provider-b',
      'shared-image',
      'ambiguous-legacy-user',
    )).rejects.toThrow('migration required');
  });

  it('resolves legacy uniqueness from the complete configured catalog, not a requested subset', async () => {
    const result = await resolveTaskModelCatalogResult(
      [{
        id: 'shared-image',
        name: 'Shared Image A',
        providerId: 'provider-a',
        type: 'image',
      }],
      createUser({
        id: 'ambiguous-subset-user',
        imageModels: ['shared-image'],
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
    );

    expect(result.authorizedModelKeys.has(taskModelKey('provider-a', 'shared-image'))).toBe(false);
    expect(result.modelAuthorizationMigration.required).toEqual([
      expect.objectContaining({
        legacyModelId: 'shared-image',
        reason: 'ambiguous',
        candidates: ['provider-a::shared-image', 'provider-b::shared-image'],
      }),
    ]);
  });

  it('requires an exact provider and model pair before applying current authorization', async () => {
    await expect(resolveTaskModel('provider-a', 'shared-image', 'user-a')).resolves.toMatchObject({
      providerId: 'provider-a',
      modelId: 'shared-image',
    });
    await expect(resolveTaskModel('provider-b', 'shared-image', 'user-a')).rejects.toThrow(
      'not authorized',
    );
    await expect(resolveTaskModel('provider-a', 'dall-e-3', 'admin-a')).rejects.toThrow(
      'not configured',
    );
  });

  it('uses chat model exact assignments to authorize VLM models consistently', async () => {
    await expect(resolveTaskModel(
      'vlm-provider',
      'qwen3-vl',
      'vlm-selected-user',
    )).resolves.toMatchObject({
      providerId: 'vlm-provider',
      modelId: 'qwen3-vl',
      kind: 'chat',
      supportsReferenceImages: true,
    });

    await expect(resolveTaskModel(
      'vlm-provider',
      'qwen3-vl',
      'vlm-unselected-user',
    )).rejects.toThrow('not authorized');
  });

  it('uses the dedicated provider type for permissions even when discovery is stale', async () => {
    await expect(resolveTaskModel(
      'layer-provider',
      'stale-layer',
      'layer-denied-user',
    )).rejects.toThrow('not authorized');

    await expect(resolveTaskModel(
      'layer-provider',
      'stale-layer',
      'admin-a',
    )).resolves.toMatchObject({ kind: 'layer' });
  });

  it('ignores identity overrides and bounds capability override values', async () => {
    const descriptor = await resolveTaskModel('provider-a', 'shared-image', 'admin-a');

    expect(descriptor).toMatchObject({
      providerId: 'provider-a',
      modelId: 'shared-image',
      kind: 'image',
      maxOutputs: 1,
    });
    expect(descriptor.maxDurationSeconds).toBeUndefined();
  });

  it('only reads own override properties from provider configuration', async () => {
    const descriptor = await resolveTaskModel(
      'inherited-override-provider',
      'gpt-image-1',
      'admin-a',
    );

    expect(descriptor.supportsMask).toBe(true);
  });

  it('checks final kind permission before authorizing descriptor-null audio models', async () => {
    const audioModel = [{
      id: 'speech-1',
      name: 'Speech 1',
      providerId: 'audio-provider',
      type: 'audio' as const,
    }];
    const permissions = {
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
      audio: false,
    };

    const denied = await resolveTaskModelCatalogResult(
      audioModel,
      createUser({ id: 'audio-denied', apiPermissions: permissions }),
    );
    const permitted = await resolveTaskModelCatalogResult(
      audioModel,
      createUser({
        id: 'audio-permitted',
        apiPermissions: { ...permissions, audio: true },
      }),
    );

    expect(denied.authorizedModelKeys.has('audio-provider::speech-1')).toBe(false);
    expect(permitted.authorizedModelKeys.has('audio-provider::speech-1')).toBe(true);
    expect(permitted.taskModelCatalog).not.toContainEqual(
      expect.objectContaining({
        providerId: 'audio-provider',
        modelId: 'speech-1',
      }),
    );
  });

  it('uses canonical configured keys for 302 legacy, alias, and explicit unknown selections', async () => {
    await expect(resolveTaskModel(
      '302-legacy-provider',
      '302-super-upscale-v2',
      'admin-a',
    )).resolves.toMatchObject({
      providerId: '302-legacy-provider',
      modelId: '302-super-upscale-v2',
      kind: 'upscale',
    });
    await expect(resolveTaskModel(
      '302-alias-provider',
      '302-upscale-v6',
      'admin-a',
    )).resolves.toMatchObject({
      providerId: '302-alias-provider',
      modelId: '302-upscale-v6',
      kind: 'upscale',
    });
    await expect(resolveTaskModel(
      '302-alias-provider',
      'upscale-v6',
      'admin-a',
    )).resolves.toMatchObject({
      providerId: '302-alias-provider',
      modelId: '302-upscale-v6',
      kind: 'upscale',
    });
    await expect(resolveTaskModel(
      '302-unknown-provider',
      'custom-upscale',
      'admin-a',
    )).resolves.toMatchObject({
      providerId: '302-unknown-provider',
      modelId: 'custom-upscale',
      kind: 'upscale',
    });
  });

  it('canonicalizes existing exact and bare 302 alias assignments during authorization', async () => {
    await expect(resolveTaskModel(
      '302-alias-provider',
      '302-upscale-v6',
      '302-exact-alias-user',
    )).resolves.toMatchObject({
      modelId: '302-upscale-v6',
      kind: 'upscale',
    });

    const providers = await mocks.getApiProviders();
    mocks.getApiProviders.mockResolvedValue(
      providers.filter((provider: ApiProvider) => provider.id !== '302-legacy-provider'),
    );
    await expect(resolveTaskModel(
      '302-alias-provider',
      '302-upscale-v6',
      '302-bare-alias-user',
    )).resolves.toMatchObject({
      modelId: '302-upscale-v6',
      kind: 'upscale',
    });
  });
});
