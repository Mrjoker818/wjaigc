import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getApiProviders: vi.fn(),
  getPublicApiProviders: vi.fn(),
  getPublicModelCatalogSnapshot: vi.fn(),
  getPublicModels: vi.fn(),
  getRuntimeSettings: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server-api-config')>(),
  getApiProviders: mocks.getApiProviders,
  getPublicApiProviders: mocks.getPublicApiProviders,
  getPublicModelCatalogSnapshot: mocks.getPublicModelCatalogSnapshot,
  getPublicModels: mocks.getPublicModels,
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: mocks.getRuntimeSettings }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));

import { GET } from '@/app/api/models/route';

describe('model defaults', () => {
  beforeEach(() => {
    mocks.getApiProviders.mockResolvedValue([
      {
        id: 'provider-a',
        name: 'Provider A',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        isEnabled: true,
        type: 'universal',
        modelType: 'universal',
        selectedModels: ['image-a', 'chat-a', 'shared-chat'],
        discoveredModels: [
          { id: 'image-a', name: 'Image A', providerId: 'provider-a', type: 'image' },
          { id: 'chat-a', name: 'Chat A', providerId: 'provider-a', type: 'chat' },
          { id: 'shared-chat', name: 'Provider A Chat', providerId: 'provider-a', type: 'chat' },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'provider-b',
        name: 'Provider B',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        isEnabled: true,
        type: 'universal',
        modelType: 'universal',
        selectedModels: ['image-b', 'chat-b', 'shared-chat'],
        discoveredModels: [
          { id: 'image-b', name: 'Image B', providerId: 'provider-b', type: 'image' },
          { id: 'chat-b', name: 'Chat B', providerId: 'provider-b', type: 'chat' },
          { id: 'shared-chat', name: 'Provider B Chat', providerId: 'provider-b', type: 'chat' },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'layer-provider',
        name: 'Layer Provider',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        isEnabled: true,
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
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mocks.getPublicApiProviders.mockResolvedValue([]);
    mocks.getPublicModels.mockResolvedValue([
      { id: 'image-a', name: 'Image A', providerId: 'provider-a' },
      { id: 'image-b', name: 'Image B', providerId: 'provider-b' },
    ]);
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultImageModel: 'provider-a::image-a',
      quickCreateImageModel: 'provider-b::image-b',
      quickCreateAutoModelRouting: true,
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.getPublicModelCatalogSnapshot.mockImplementation(async () => ({
      configuredProviders: await mocks.getApiProviders(),
      providers: await mocks.getPublicApiProviders(),
      models: await mocks.getPublicModels(undefined),
    }));
  });

  it('marks the configured default image model without changing the available model list', async () => {
    const response = await GET(new NextRequest('http://localhost/api/models?type=image'));
    const data = await response.json();

    expect(data.models).toEqual([
      { id: 'image-a', name: 'Image A', providerId: 'provider-a', isDefault: true },
      { id: 'image-b', name: 'Image B', providerId: 'provider-b', isDefault: false },
    ]);
    expect(data.quickCreatePolicy).toEqual({
      autoModelRouting: true,
      globalDefault: 'provider-a::image-a',
      quickCreateDefault: 'provider-b::image-b',
    });
    expect(data.taskModelCatalog).toEqual([
      expect.objectContaining({
        providerId: 'provider-a',
        modelId: 'image-a',
        kind: 'image',
        executionMode: 'sync',
      }),
      expect.objectContaining({
        providerId: 'provider-b',
        modelId: 'image-b',
        kind: 'image',
        executionMode: 'sync',
      }),
    ]);
  });

  it('does not expose configured defaults that are unavailable to the current user', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      imageModels: ['image-a'],
    });

    const response = await GET(new NextRequest('http://localhost/api/models?type=image'));
    const data = await response.json();

    expect(data.models).toHaveLength(1);
    expect(data.quickCreatePolicy).toEqual({
      autoModelRouting: true,
      globalDefault: 'provider-a::image-a',
      quickCreateDefault: '',
    });
  });

  it('returns the enabled chat catalog when a user has no explicit chat allowlist', async () => {
    mocks.getPublicModels.mockResolvedValue([
      { id: 'chat-a', name: 'Chat A', providerId: 'provider-a' },
    ]);
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-a::chat-a',
      quickCreateChatModel: 'provider-a::chat-a',
      quickCreateAutoModelRouting: true,
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1', role: 'user', chatModels: [] });

    const response = await GET(new NextRequest('http://localhost/api/models?type=chat'));
    const data = await response.json();

    expect(data.models).toEqual([
      { id: 'chat-a', name: 'Chat A', providerId: 'provider-a', isDefault: true },
    ]);
    expect(data.quickCreatePolicy).toEqual({
      autoModelRouting: true,
      globalDefault: 'provider-a::chat-a',
      quickCreateDefault: 'provider-a::chat-a',
    });
  });

  it('supports legacy bare chat model assignments', async () => {
    mocks.getPublicModels.mockResolvedValue([
      { id: 'chat-a', name: 'Chat A', providerId: 'provider-a' },
      { id: 'chat-b', name: 'Chat B', providerId: 'provider-b' },
    ]);
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-a::chat-a',
      quickCreateChatModel: 'provider-b::chat-b',
      quickCreateAutoModelRouting: false,
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1', role: 'user', chatModels: ['chat-a'] });

    const response = await GET(new NextRequest('http://localhost/api/models?type=chat'));
    const data = await response.json();

    expect(data.models.map((model: { id: string }) => model.id)).toEqual(['chat-a']);
    expect(data.taskModelCatalog).toEqual([
      expect.objectContaining({
        providerId: 'provider-a',
        modelId: 'chat-a',
        kind: 'chat',
      }),
    ]);
    expect(data.modelAuthorizationMigration).toEqual({
      resolved: [{
        legacyModelId: 'chat-a',
        reason: 'unique',
        count: 1,
      }],
      required: [],
    });
    expect(data.quickCreatePolicy).toEqual({
      autoModelRouting: false,
      globalDefault: 'provider-a::chat-a',
      quickCreateDefault: '',
    });
  });

  it('rejects ambiguous legacy bare assignments consistently in models and task catalog', async () => {
    mocks.getPublicModels.mockResolvedValue([
      { id: 'shared-chat', name: 'Provider A Chat', providerId: 'provider-a', type: 'chat' },
      { id: 'shared-chat', name: 'Provider B Chat', providerId: 'provider-b', type: 'chat' },
    ]);
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-a::shared-chat',
      quickCreateChatModel: 'provider-b::shared-chat',
      quickCreateAutoModelRouting: true,
    });
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      chatModels: ['shared-chat'],
    });

    const response = await GET(new NextRequest('http://localhost/api/models?type=chat'));
    const data = await response.json();

    expect(data.models).toEqual([]);
    expect(data.taskModelCatalog).toEqual([]);
    expect(data.modelAuthorizationMigration).toEqual({
      resolved: [],
      required: [{
        legacyModelId: 'shared-chat',
        reason: 'ambiguous',
        count: 2,
      }],
    });
  });

  it('keeps provider-bound chat assignments isolated across providers with the same model id', async () => {
    mocks.getPublicModels.mockResolvedValue([
      { id: 'shared-chat', name: 'Provider A Chat', providerId: 'provider-a' },
      { id: 'shared-chat', name: 'Provider B Chat', providerId: 'provider-b' },
    ]);
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultChatModel: 'provider-b::shared-chat',
      quickCreateChatModel: 'provider-a::shared-chat',
      quickCreateAutoModelRouting: true,
    });
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      chatModels: ['provider-a::shared-chat'],
    });

    const response = await GET(new NextRequest('http://localhost/api/models?type=chat'));
    const data = await response.json();

    expect(data.models).toEqual([
      { id: 'shared-chat', name: 'Provider A Chat', providerId: 'provider-a', isDefault: false },
    ]);
    expect(data.quickCreatePolicy).toEqual({
      autoModelRouting: true,
      globalDefault: '',
      quickCreateDefault: 'provider-a::shared-chat',
    });
    expect(data.taskModelCatalog).toEqual([
      expect.objectContaining({
        providerId: 'provider-a',
        modelId: 'shared-chat',
        kind: 'chat',
      }),
    ]);
  });

  it('uses the dedicated layer type for both permission checks and catalog kind', async () => {
    mocks.getPublicModels.mockResolvedValue([
      {
        id: 'stale-layer',
        name: 'Stale Layer Type',
        providerId: 'layer-provider',
        type: 'image',
      },
    ]);
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      imageModels: ['layer-provider::stale-layer'],
      apiPermissions: {
        image: true,
        layer: false,
      },
    });

    const response = await GET(new NextRequest('http://localhost/api/models?type=layer'));
    const data = await response.json();

    expect(data.models).toEqual([]);
    expect(data.taskModelCatalog).toEqual([]);
  });
});
