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
    mocks.getRuntimeSettings.mockResolvedValue({
      defaultImageModel: 'provider-a::image-a',
      quickCreateImageModel: 'provider-b::image-b',
      quickCreateAutoModelRouting: true,
    });
    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
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
    expect(data.quickCreatePolicy).toEqual({
      autoModelRouting: false,
      globalDefault: 'provider-a::chat-a',
      quickCreateDefault: '',
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
  });
});
