import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGetSystemSetting: vi.fn(),
}));

vi.mock('@/lib/db-storage', () => ({
  dbGetSystemSetting: mocks.dbGetSystemSetting,
}));

import { getRuntimeSettings } from '@/lib/runtime-settings';

describe('runtime settings', () => {
  beforeEach(() => {
    mocks.dbGetSystemSetting.mockReset();
  });

  it('returns the configured maximum image edge', async () => {
    mocks.dbGetSystemSetting.mockImplementation(async (key: string) => (
      key === 'imageMaxEdge' ? '4096' : null
    ));

    await expect(getRuntimeSettings()).resolves.toMatchObject({ imageMaxEdge: 4096 });
  });

  it('returns configured default models without inventing a fallback model', async () => {
    mocks.dbGetSystemSetting.mockImplementation(async (key: string) => (
      key === 'defaultImageModel' ? 'provider-a::image-a' : null
    ));

    await expect(getRuntimeSettings()).resolves.toMatchObject({
      defaultImageModel: 'provider-a::image-a',
      defaultChatModel: '',
      defaultVideoModel: '',
      quickCreateImageModel: '',
      quickCreateChatModel: '',
      quickCreateAutoModelRouting: true,
    });
  });

  it('uses quick create models when configured and normalizes auto routing', async () => {
    mocks.dbGetSystemSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string> = {
        defaultImageModel: 'provider-a::image-default',
        defaultChatModel: 'provider-a::chat-default',
        quickCreateImageModel: 'provider-b::image-fast',
        quickCreateChatModel: 'provider-b::chat-fast',
        quickCreateAutoModelRouting: 'false',
      };
      return values[key] ?? null;
    });

    await expect(getRuntimeSettings()).resolves.toMatchObject({
      quickCreateImageModel: 'provider-b::image-fast',
      quickCreateChatModel: 'provider-b::chat-fast',
      quickCreateAutoModelRouting: false,
    });
  });

  it('preserves blank quick create model settings for routing policy decisions', async () => {
    mocks.dbGetSystemSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string> = {
        defaultImageModel: 'provider-a::image-default',
        defaultChatModel: 'provider-a::chat-default',
        quickCreateImageModel: '   ',
        quickCreateChatModel: '',
      };
      return values[key] ?? null;
    });

    await expect(getRuntimeSettings()).resolves.toMatchObject({
      quickCreateImageModel: '',
      quickCreateChatModel: '',
    });
  });
});
