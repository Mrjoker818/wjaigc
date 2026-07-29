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
});
