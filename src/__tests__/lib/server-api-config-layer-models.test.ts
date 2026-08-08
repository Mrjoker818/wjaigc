import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGetApiProviders: vi.fn(),
  dbUpsertApiProvider: vi.fn(),
  dbDeleteApiProvider: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-storage', () => mocks);

import { getPublicModels } from '@/lib/server-api-config';

describe('server API config layer models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbGetApiProviders.mockResolvedValue([
      {
        id: 'pear-layer',
        name: 'Pear layer',
        display_name: 'Pear layer',
        base_url: 'https://api.pearapi.ai',
        api_key: 'server-secret',
        is_enabled: true,
        type: 'layer',
        model_type: 'layer',
        request_style: 'images-generations',
        selected_models: ['Image-Layered'],
        discovered_models: [
          {
            id: 'Image-Layered',
            name: 'Image Layered',
            type: 'image',
          },
        ],
        advanced_params: {},
        is_default: false,
        created_at: 1,
        updated_at: 1,
        connection_status: 'success',
        sort_order: 0,
      },
    ]);
  });

  it('exposes an explicitly selected model from a dedicated layer provider despite stale discovered type', async () => {
    await expect(getPublicModels('layer')).resolves.toEqual([
      expect.objectContaining({
        id: 'Image-Layered',
        providerId: 'pear-layer',
        type: 'layer',
      }),
    ]);
  });

  it('uses real universal-provider inference before filtering a stale Kling discovery as video', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      {
        id: 'universal-provider',
        name: 'Universal provider',
        display_name: 'Universal provider',
        base_url: 'https://dashscope.aliyuncs.com',
        api_key: 'server-secret',
        is_enabled: true,
        type: 'universal',
        model_type: 'universal',
        request_style: 'auto',
        selected_models: ['kling-v2-image-to-video'],
        discovered_models: [
          {
            id: 'kling-v2-image-to-video',
            name: 'Kling V2 Image to Video',
            type: 'image',
          },
        ],
        advanced_params: {},
        is_default: false,
        created_at: 1,
        updated_at: 1,
        connection_status: 'success',
        sort_order: 0,
      },
    ]);

    await expect(getPublicModels('video')).resolves.toEqual([
      expect.objectContaining({
        id: 'kling-v2-image-to-video',
        providerId: 'universal-provider',
        type: 'video',
      }),
    ]);
  });

  it('uses a dedicated provider type before filtering stale discovery metadata', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      {
        id: 'image-provider',
        name: 'Image provider',
        display_name: 'Image provider',
        base_url: 'https://api.openai.com/v1',
        api_key: 'server-secret',
        is_enabled: true,
        type: 'image',
        model_type: 'image',
        request_style: 'images-generations',
        selected_models: ['image-model'],
        discovered_models: [
          {
            id: 'image-model',
            name: 'Image Model',
            type: 'chat',
          },
        ],
        advanced_params: {},
        is_default: false,
        created_at: 1,
        updated_at: 1,
        connection_status: 'success',
        sort_order: 0,
      },
    ]);

    await expect(getPublicModels('image')).resolves.toEqual([
      expect.objectContaining({
        id: 'image-model',
        providerId: 'image-provider',
        type: 'image',
      }),
    ]);
  });

  it('keeps every configured selection when discovery only contains part of the selected catalog', async () => {
    mocks.dbGetApiProviders.mockResolvedValue([
      {
        id: 'partial-discovery',
        name: 'Partial discovery',
        display_name: 'Partial discovery',
        base_url: 'https://api.example.com/v1',
        api_key: 'server-secret',
        is_enabled: true,
        type: 'image',
        model_type: 'image',
        request_style: 'images-generations',
        selected_models: ['discovered-image', 'configured-image'],
        discovered_models: [
          {
            id: 'discovered-image',
            name: 'Discovered Image',
            type: 'image',
          },
        ],
        advanced_params: {},
        is_default: false,
        created_at: 1,
        updated_at: 1,
        connection_status: 'success',
        sort_order: 0,
      },
    ]);

    await expect(getPublicModels('image')).resolves.toEqual([
      expect.objectContaining({
        id: 'discovered-image',
        providerId: 'partial-discovery',
      }),
      expect.objectContaining({
        id: 'configured-image',
        providerId: 'partial-discovery',
      }),
    ]);
  });
});
