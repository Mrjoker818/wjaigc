import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGetUserById: vi.fn(),
  findProviderById: vi.fn(),
  isModelAssignedToUser: vi.fn(),
}));

vi.mock('@/lib/db-storage', () => ({ dbGetUserById: mocks.dbGetUserById }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: mocks.findProviderById }));
vi.mock('@/lib/model-defaults', () => ({ isModelAssignedToUser: mocks.isModelAssignedToUser }));

const provider = {
  id: 'image-provider',
  name: 'Image provider',
  baseUrl: 'https://images.example.com/v1',
  apiKey: 'secret',
  isEnabled: true,
  type: 'image',
  modelType: 'image',
  selectedModels: ['gpt-image-1'],
  discoveredModels: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('element board provider authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProviderById.mockResolvedValue(provider);
    mocks.dbGetUserById.mockResolvedValue({
      id: 'user-1',
      image_models: ['image-provider::gpt-image-1'],
      api_permissions: { image: true, imageEdit: true },
    });
    mocks.isModelAssignedToUser.mockReturnValue(true);
  });

  it('returns only the exact configured and assigned provider/model pair', async () => {
    const { resolveElementBoardProvider } = await import('@/lib/element-decomposition/board-provider');
    const resolved = await resolveElementBoardProvider({
      userId: 'user-1',
      userRole: 'user',
      providerId: 'image-provider',
      modelId: 'gpt-image-1',
    });

    expect(resolved.provider.id).toBe('image-provider');
    expect(resolved.modelId).toBe('gpt-image-1');
    expect(mocks.isModelAssignedToUser).toHaveBeenCalledWith(
      ['image-provider::gpt-image-1'],
      'image-provider',
      'gpt-image-1',
    );
  });

  it('rejects a model not configured on the exact provider', async () => {
    const { resolveElementBoardProvider } = await import('@/lib/element-decomposition/board-provider');
    await expect(resolveElementBoardProvider({
      userId: 'user-1', userRole: 'user', providerId: 'image-provider', modelId: 'other-model',
    })).rejects.toMatchObject({ code: 'ELEMENT_BOARD_MODEL_UNSUPPORTED' });
  });

  it('rejects an unassigned user before provider execution', async () => {
    mocks.isModelAssignedToUser.mockReturnValue(false);
    const { resolveElementBoardProvider } = await import('@/lib/element-decomposition/board-provider');
    await expect(resolveElementBoardProvider({
      userId: 'user-1', userRole: 'user', providerId: 'image-provider', modelId: 'gpt-image-1',
    })).rejects.toMatchObject({ code: 'ELEMENT_BOARD_MODEL_FORBIDDEN' });
  });
});
