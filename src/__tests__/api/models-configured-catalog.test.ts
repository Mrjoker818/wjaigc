import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  dbGetApiProviders: vi.fn(),
  dbUpsertApiProvider: vi.fn(),
  dbDeleteApiProvider: vi.fn(),
  getRuntimeSettings: vi.fn(),
  getSessionUser: vi.fn(),
  listManagedUsers: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-storage', () => ({
  dbGetApiProviders: mocks.dbGetApiProviders,
  dbUpsertApiProvider: mocks.dbUpsertApiProvider,
  dbDeleteApiProvider: mocks.dbDeleteApiProvider,
}));
vi.mock('@/lib/runtime-settings', () => ({
  getRuntimeSettings: mocks.getRuntimeSettings,
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
  listManagedUsers: mocks.listManagedUsers,
}));

import { GET as getModels } from '@/app/api/models/route';
import { GET as getWorkflowModels } from '@/app/api/workflow/models/route';
import { resolveTaskModel } from '@/lib/task-core/model-catalog';

interface ProviderRowOptions {
  id: string;
  modelType: string;
  modelId: string;
  discoveredType: string;
  name?: string;
  isEnabled?: boolean;
}

function providerRow(options: ProviderRowOptions) {
  return {
    id: options.id,
    name: options.name || options.id,
    display_name: options.name || options.id,
    base_url: 'https://api.example.com/v1',
    api_key: 'server-secret',
    is_enabled: options.isEnabled ?? true,
    type: options.modelType,
    model_type: options.modelType,
    request_style: 'auto',
    selected_models: [options.modelId],
    discovered_models: [{
      id: options.modelId,
      name: options.modelId,
      type: options.discoveredType,
    }],
    advanced_params: {},
    is_default: false,
    created_at: 1,
    updated_at: 1,
    connection_status: 'success',
    sort_order: 0,
  };
}

function userPermissions(overrides: Partial<Record<string, boolean>> = {}) {
  return {
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
    ...overrides,
  };
}

describe('configured task model catalog APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultImageModel: '',
      defaultChatModel: '',
      defaultVideoModel: '',
      quickCreateImageModel: '',
      quickCreateChatModel: '',
      quickCreateAutoModelRouting: true,
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.listManagedUsers.mockResolvedValue([{ id: 'admin-1', role: 'admin' }]);
  });

  it('builds each API response from one configured snapshot and filters only final effective kinds', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      providerRow({
        id: 'universal-provider',
        modelType: 'universal',
        modelId: 'kling-v2-image-to-video',
        discoveredType: 'image',
        name: 'Universal Provider',
      }),
      providerRow({
        id: 'layer-provider',
        modelType: 'layer',
        modelId: 'stale-layer',
        discoveredType: 'image',
        name: 'Layer Provider',
      }),
    ]);

    const videoResponse = await getModels(
      new NextRequest('http://localhost/api/models?type=video'),
    );
    const videoData = await videoResponse.json();

    expect(videoData.capabilityCatalogVersion).toBe(1);
    expect(videoData.models).toEqual([
      expect.objectContaining({
        id: 'kling-v2-image-to-video',
        providerId: 'universal-provider',
        type: 'video',
      }),
    ]);
    expect(videoData.taskModelCatalog).toEqual([
      expect.objectContaining({
        providerId: 'universal-provider',
        modelId: 'kling-v2-image-to-video',
        kind: 'video',
      }),
    ]);
    expect(mocks.dbGetApiProviders).toHaveBeenCalledTimes(1);

    mocks.dbGetApiProviders.mockClear();
    const layerResponse = await getWorkflowModels(
      new NextRequest('http://localhost/api/workflow/models?type=layer'),
    );
    const layerData = await layerResponse.json();

    expect(layerData.capabilityCatalogVersion).toBe(1);
    expect(layerData.models).toEqual([
      expect.objectContaining({
        id: 'stale-layer',
        providerId: 'layer-provider',
        provider: 'Layer Provider',
        type: 'layer',
      }),
    ]);
    expect(layerData.taskModelCatalog).toEqual([
      expect.objectContaining({
        providerId: 'layer-provider',
        modelId: 'stale-layer',
        kind: 'layer',
      }),
    ]);
    expect(mocks.dbGetApiProviders).toHaveBeenCalledTimes(1);
  });

  it('uses the complete permission-eligible catalog for bare uniqueness across all API type filters', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      providerRow({
        id: 'image-provider',
        modelType: 'image',
        modelId: 'shared-model',
        discoveredType: 'image',
        name: 'Image Provider',
      }),
      providerRow({
        id: 'layer-provider',
        modelType: 'layer',
        modelId: 'shared-model',
        discoveredType: 'image',
        name: 'Layer Provider',
      }),
    ]);
    const user = {
      id: 'user-1',
      name: 'User 1',
      role: 'user' as const,
      status: 'active' as const,
      imageModels: ['shared-model'],
      apiPermissions: userPermissions(),
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.listManagedUsers.mockResolvedValue([user]);

    const imageData = await (
      await getModels(new NextRequest('http://localhost/api/models?type=image'))
    ).json();
    const layerData = await (
      await getWorkflowModels(
        new NextRequest('http://localhost/api/workflow/models?type=layer'),
      )
    ).json();
    const allData = await (
      await getModels(new NextRequest('http://localhost/api/models?type=all'))
    ).json();

    for (const data of [imageData, layerData, allData]) {
      expect(data.models).toEqual([]);
      expect(data.taskModelCatalog).toEqual([]);
      expect(data.modelAuthorizationMigration).toEqual({
        resolved: [],
        required: [{
          legacyModelId: 'shared-model',
          reason: 'ambiguous',
          count: 2,
        }],
      });
    }

    await expect(
      resolveTaskModel('image-provider', 'shared-model', 'user-1'),
    ).rejects.toThrow('migration required');
    await expect(
      resolveTaskModel('layer-provider', 'shared-model', 'user-1'),
    ).rejects.toThrow('migration required');
  });

  it('does not expose exact pair details in regular-user migration diagnostics', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      providerRow({
        id: 'image-provider',
        modelType: 'image',
        modelId: 'unique-model',
        discoveredType: 'image',
      }),
    ]);
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      imageModels: ['unique-model'],
      apiPermissions: userPermissions(),
    });

    const data = await (
      await getModels(new NextRequest('http://localhost/api/models?type=all'))
    ).json();

    expect(data.models).toEqual([
      expect.objectContaining({
        id: 'unique-model',
        providerId: 'image-provider',
      }),
    ]);
    expect(data.modelAuthorizationMigration).toEqual({
      resolved: [{
        legacyModelId: 'unique-model',
        reason: 'unique',
        count: 1,
      }],
      required: [],
    });
  });

  it('limits regular-user provider metadata to visible models while preserving the admin snapshot', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      providerRow({
        id: 'provider-a',
        modelType: 'image',
        modelId: 'image-a',
        discoveredType: 'image',
      }),
      providerRow({
        id: 'provider-b',
        modelType: 'image',
        modelId: 'image-b',
        discoveredType: 'image',
      }),
      providerRow({
        id: 'provider-disabled',
        modelType: 'image',
        modelId: 'disabled-image',
        discoveredType: 'image',
        isEnabled: false,
      }),
    ]);
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      imageModels: [
        'provider-a::image-a',
        'provider-disabled::disabled-image',
      ],
      apiPermissions: userPermissions(),
    });

    const regularData = await (
      await getModels(new NextRequest('http://localhost/api/models?type=image'))
    ).json();

    expect(regularData.models.map((model: { providerId: string }) => model.providerId))
      .toEqual(['provider-a']);
    expect(regularData.providers.map((provider: { id: string }) => provider.id))
      .toEqual(['provider-a']);
    expect(mocks.dbUpsertApiProvider).not.toHaveBeenCalled();

    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    const adminData = await (
      await getModels(new NextRequest('http://localhost/api/models?type=image'))
    ).json();

    expect(adminData.providers.map((provider: { id: string }) => provider.id))
      .toEqual(['provider-a', 'provider-b', 'provider-disabled']);
    expect(mocks.dbUpsertApiProvider).not.toHaveBeenCalled();
  });

  it('applies descriptor-null audio permission before exposing legacy model fields', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      providerRow({
        id: 'audio-provider',
        modelType: 'audio',
        modelId: 'speech-1',
        discoveredType: 'audio',
      }),
    ]);
    mocks.getSessionUser.mockResolvedValue({
      id: 'user-1',
      role: 'user',
      apiPermissions: userPermissions({ audio: false }),
    });

    const data = await (
      await getModels(new NextRequest('http://localhost/api/models?type=all'))
    ).json();

    expect(data.models).toEqual([]);
    expect(data.taskModelCatalog).toEqual([]);
  });
});
