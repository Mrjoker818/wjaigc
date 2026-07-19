import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getPublicApiProviders: vi.fn(),
  getPublicModels: vi.fn(),
  getRuntimeSettings: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock('@/lib/server-api-config', () => ({
  getPublicApiProviders: mocks.getPublicApiProviders,
  getPublicModels: mocks.getPublicModels,
}));
vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: mocks.getRuntimeSettings }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));

import { GET } from '@/app/api/models/route';

describe('model defaults', () => {
  beforeEach(() => {
    mocks.getPublicApiProviders.mockResolvedValue([]);
    mocks.getPublicModels.mockResolvedValue([
      { id: 'image-a', name: 'Image A', providerId: 'provider-a' },
      { id: 'image-b', name: 'Image B', providerId: 'provider-b' },
    ]);
    mocks.getRuntimeSettings.mockResolvedValue({ defaultImageModel: 'provider-a::image-a' });
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1', role: 'user' });
  });

  it('marks the configured default image model without changing the available model list', async () => {
    const response = await GET(new NextRequest('http://localhost/api/models?type=image'));
    const data = await response.json();

    expect(data.models).toEqual([
      { id: 'image-a', name: 'Image A', providerId: 'provider-a', isDefault: true },
      { id: 'image-b', name: 'Image B', providerId: 'provider-b', isDefault: false },
    ]);
  });
});
