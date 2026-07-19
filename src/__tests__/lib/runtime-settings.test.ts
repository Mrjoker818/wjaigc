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
    });
  });
});
