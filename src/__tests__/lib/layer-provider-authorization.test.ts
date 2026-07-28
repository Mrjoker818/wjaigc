import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findProviderById: vi.fn(),
  dbGetUserById: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  findProviderById: mocks.findProviderById,
}));

vi.mock('@/lib/db-storage', () => ({
  dbGetUserById: mocks.dbGetUserById,
}));

import { resolveLayerProvider } from '@/lib/layer-decomposition/provider';

const pearProvider = {
  id: 'pear',
  name: 'Pear',
  baseUrl: 'https://api.pearapi.ai',
  apiKey: 'server-secret',
  isEnabled: true,
  type: 'layer',
  modelType: 'layer',
  selectedModels: ['Image-Layered'],
};

describe('layer provider authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProviderById.mockResolvedValue(pearProvider);
  });

  it('normalizes the Pear payload model while retaining configured identity', async () => {
    const resolved = await resolveLayerProvider({
      userId: 'admin-1',
      userRole: 'admin',
      providerId: 'pear',
      modelId: 'Image-Layered',
    });

    expect(resolved.provider.id).toBe('pear');
    expect(resolved.configuredModelId).toBe('Image-Layered');
    expect(resolved.requestModelId).toBe('image-layered');
    expect(mocks.dbGetUserById).not.toHaveBeenCalled();
  });

  it('rejects a layer model not assigned to a normal user', async () => {
    mocks.dbGetUserById.mockResolvedValue({
      id: 'user-1',
      api_permissions: { layer: true },
      image_models: ['another-provider::Image-Layered'],
    });

    await expect(resolveLayerProvider({
      userId: 'user-1',
      userRole: 'user',
      providerId: 'pear',
      modelId: 'Image-Layered',
    })).rejects.toMatchObject({ code: 'LAYER_MODEL_FORBIDDEN' });
  });

  it('rejects disabled layer permission even when the model is assigned', async () => {
    mocks.dbGetUserById.mockResolvedValue({
      id: 'user-1',
      api_permissions: { layer: false },
      image_models: ['pear::Image-Layered'],
    });

    await expect(resolveLayerProvider({
      userId: 'user-1',
      userRole: 'user',
      providerId: 'pear',
      modelId: 'Image-Layered',
    })).rejects.toMatchObject({ code: 'LAYER_MODEL_FORBIDDEN' });
  });

  it('accepts an exactly assigned provider and model', async () => {
    mocks.dbGetUserById.mockResolvedValue({
      id: 'user-1',
      api_permissions: { layer: true },
      image_models: ['pear::Image-Layered'],
    });

    await expect(resolveLayerProvider({
      userId: 'user-1',
      userRole: 'user',
      providerId: 'pear',
      modelId: 'Image-Layered',
    })).resolves.toMatchObject({
      configuredModelId: 'Image-Layered',
      requestModelId: 'image-layered',
    });
  });
});
