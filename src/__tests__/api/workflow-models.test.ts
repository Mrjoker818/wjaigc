import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getApiProviders: vi.fn(),
  getPublicApiProviders: vi.fn(),
  getPublicModelCatalogSnapshot: vi.fn(),
  getPublicModels: vi.fn(),
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

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));

import { GET } from '@/app/api/workflow/models/route';

describe('GET /api/workflow/models', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getApiProviders.mockResolvedValue([
      {
        id: 'image-provider',
        name: 'Image Provider',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        isEnabled: true,
        type: 'image',
        modelType: 'image',
        selectedModels: ['image-model'],
        discoveredModels: [
          { id: 'image-model', name: 'Image Model', providerId: 'image-provider', type: 'image' },
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
        selectedModels: ['layer-model'],
        discoveredModels: [
          { id: 'layer-model', name: 'Layer Model', providerId: 'layer-provider', type: 'image' },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mocks.getPublicApiProviders.mockResolvedValue([
      { id: 'image-provider', displayName: 'Image Provider' },
      { id: 'layer-provider', name: 'Layer Provider' },
    ]);
    mocks.getPublicModels.mockResolvedValue([
      { id: 'image-model', name: 'Image Model', providerId: 'image-provider', type: 'image' },
      { id: 'layer-model', name: 'Layer Model', providerId: 'layer-provider', type: 'layer' },
    ]);
    mocks.getPublicModelCatalogSnapshot.mockImplementation(async () => ({
      configuredProviders: await mocks.getApiProviders(),
      providers: await mocks.getPublicApiProviders(),
      models: await mocks.getPublicModels(undefined),
    }));
  });

  it('returns all selectable workflow models when type is all', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      apiPermissions: { layer: true },
      imageModels: ['image-provider::image-model', 'layer-provider::layer-model'],
    });

    const response = await GET(new NextRequest('http://localhost/api/workflow/models?type=all'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getPublicModels).toHaveBeenCalledWith(undefined);
    expect(data.models).toEqual([
      { id: 'image-model', name: 'Image Model', providerId: 'image-provider', provider: 'Image Provider', type: 'image' },
      { id: 'layer-model', name: 'Layer Model', providerId: 'layer-provider', provider: 'Layer Provider', type: 'layer' },
    ]);
    expect(data.taskModelCatalog).toEqual([
      expect.objectContaining({
        providerId: 'image-provider',
        modelId: 'image-model',
        kind: 'image',
      }),
      expect.objectContaining({
        providerId: 'layer-provider',
        modelId: 'layer-model',
        kind: 'layer',
      }),
    ]);
  });

  it('limits image and chat models when the current user has configured permissions', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      apiPermissions: { layer: true },
      imageModels: ['image-model', 'layer-provider::layer-model'],
      chatModels: ['another-chat'],
    });
    mocks.getPublicModels.mockResolvedValue([
      { id: 'image-model', name: 'Image Model', providerId: 'image-provider', type: 'image' },
      { id: 'other-image', name: 'Other Image', providerId: 'image-provider', type: 'image' },
      { id: 'chat-model', name: 'Chat Model', providerId: 'image-provider', type: 'chat' },
      { id: 'layer-model', name: 'Layer Model', providerId: 'layer-provider', type: 'layer' },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/workflow/models?type=all'));
    const data = await response.json();

    expect(data.models.map((model: { id: string }) => model.id)).toEqual(['image-model', 'layer-model']);
  });

  it('rejects an exact layer assignment when layer permission is false even if discovery says image', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      apiPermissions: { image: true, layer: false },
      imageModels: ['layer-provider::layer-model'],
    });
    mocks.getPublicModels.mockResolvedValue([
      {
        id: 'layer-model',
        name: 'Layer Model',
        providerId: 'layer-provider',
        type: 'image',
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/workflow/models?type=layer'));
    const data = await response.json();

    expect(data.models).toEqual([]);
    expect(data.taskModelCatalog).toEqual([]);
  });

  it('only exposes assigned layer models to a permitted non-admin user', async () => {
    mocks.getApiProviders.mockResolvedValue([
      {
        id: 'layer-provider',
        name: 'Layer Provider',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        isEnabled: true,
        type: 'layer',
        modelType: 'layer',
        selectedModels: ['Image-Layered'],
        discoveredModels: [
          {
            id: 'Image-Layered',
            name: 'Pear Layered',
            providerId: 'layer-provider',
            type: 'layer',
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      apiPermissions: { layer: true },
      imageModels: ['layer-provider::Image-Layered'],
    });
    mocks.getPublicModels.mockResolvedValue([
      { id: 'Image-Layered', name: 'Pear Layered', providerId: 'layer-provider', type: 'layer' },
      { id: 'Image-Layered', name: 'Other Layered', providerId: 'other-provider', type: 'layer' },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/workflow/models?type=layer'));
    const data = await response.json();

    expect(data.models).toEqual([
      expect.objectContaining({ id: 'Image-Layered', providerId: 'layer-provider' }),
    ]);
  });

  it('does not expose layer models without explicit layer permission', async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      imageModels: ['layer-provider::Image-Layered'],
    });
    mocks.getPublicModels.mockResolvedValue([
      { id: 'Image-Layered', name: 'Pear Layered', providerId: 'layer-provider', type: 'layer' },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/workflow/models?type=layer'));
    const data = await response.json();

    expect(data.models).toEqual([]);
  });
});
