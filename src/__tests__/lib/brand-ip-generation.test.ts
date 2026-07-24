import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getApiProviders: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
}));

import { extractProviderTaskIds, resolveImageModel } from '@/lib/brand-ip-generation';
import type { User } from '@/lib/user-types';

const user: User = {
  id: 'user-a',
  name: 'User A',
  role: 'user' as const,
  status: 'active' as const,
  imageModels: ['provider-a::image-a', 'provider-b::shared-image'],
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
  createdAt: 1,
  updatedAt: 1,
};

const imageProviders = [
  {
    id: 'provider-a',
    name: 'Provider A',
    baseUrl: 'https://provider-a.example/v1',
    apiKey: 'secret-a',
    isEnabled: true,
    type: 'image' as const,
    modelType: 'image' as const,
    selectedModels: ['image-a', 'shared-image'],
    discoveredModels: [],
  },
  {
    id: 'provider-b',
    name: 'Provider B',
    baseUrl: 'https://provider-b.example/v1',
    apiKey: 'secret-b',
    isEnabled: true,
    type: 'image' as const,
    modelType: 'image' as const,
    selectedModels: ['shared-image'],
    discoveredModels: [],
  },
];

describe('brand IP generation task response parsing', () => {
  it('keeps provider task IDs returned as an array', () => {
    expect(extractProviderTaskIds({ taskIds: ['provider-task-a', 'provider-task-b'] })).toEqual([
      'provider-task-a',
      'provider-task-b',
    ]);
  });

  it('falls back to a single provider task ID', () => {
    expect(extractProviderTaskIds({ taskId: 'provider-task-a' })).toEqual(['provider-task-a']);
  });

  it('ignores empty and non-string task IDs', () => {
    expect(extractProviderTaskIds({ taskIds: ['', null, 'provider-task-a', 42] })).toEqual(['provider-task-a']);
  });
});

describe('resolveImageModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiProviders.mockResolvedValue(imageProviders);
  });

  it('keeps legacy callers on the first authorized image model when no selection is sent', async () => {
    await expect(resolveImageModel(user)).resolves.toEqual({
      model: 'image-a',
      providerId: 'provider-a',
    });
  });

  it('accepts a complete model/provider pair that belongs to the user', async () => {
    await expect(resolveImageModel(user, 'shared-image', 'provider-b')).resolves.toEqual({
      model: 'shared-image',
      providerId: 'provider-b',
    });
  });

  it('rejects incomplete explicit image model selections', async () => {
    await expect(resolveImageModel(user, 'image-a')).resolves.toBeNull();
    await expect(resolveImageModel(user, undefined, 'provider-a')).resolves.toBeNull();
  });

  it('does not select a same-named model from another provider', async () => {
    await expect(resolveImageModel(user, 'shared-image', 'provider-a')).resolves.toBeNull();
  });

  it('rejects image models that are not in the current user authorization set', async () => {
    await expect(resolveImageModel(user, 'image-a', 'provider-b')).resolves.toBeNull();
  });
});
