import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbCreatePlatformExportPresetVersion: vi.fn(),
  dbListPlatformExportPresets: vi.fn(),
  dbSetPlatformExportPresetEnabled: vi.fn(),
}));

vi.mock('@/lib/db-storage', () => mocks);

import {
  createPlatformExportPresetVersion,
  freezePlatformExportPresets,
  listAllPlatformExportPresets,
  listEnabledPlatformExportPresets,
  setPlatformExportPresetEnabled,
} from '@/lib/multi-platform-export/presets';

describe('versioned platform export presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbListPlatformExportPresets.mockResolvedValue([]);
    mocks.dbCreatePlatformExportPresetVersion.mockImplementation(async preset => preset);
    mocks.dbSetPlatformExportPresetEnabled.mockResolvedValue(true);
  });

  it('freezes a referenced version and never replaces it with a newer version', async () => {
    const frozen = await freezePlatformExportPresets(['instagram-post-v1']);

    expect(frozen).toEqual([
      expect.objectContaining({
        id: 'instagram-post',
        version: 1,
        width: 1080,
        height: 1080,
      }),
    ]);

    await createPlatformExportPresetVersion({
      id: 'instagram-post',
      platform: 'instagram',
      usage: 'post',
      label: 'Instagram 帖子',
      width: 1200,
      height: 1200,
      recommendedFormat: 'jpeg',
      supportsTransparency: false,
      enabled: true,
    });

    await expect(freezePlatformExportPresets(['instagram-post-v1'])).resolves.toEqual(frozen);
    expect(mocks.dbCreatePlatformExportPresetVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'instagram-post', version: 2, width: 1200 }),
    );
  });

  it('returns only enabled latest versions in the public catalog', async () => {
    mocks.dbListPlatformExportPresets.mockResolvedValue([
      {
        id: 'instagram-post', version: 2, platform: 'instagram', usage: 'post',
        label: 'Instagram 帖子新版', width: 1200, height: 1200,
        recommendedFormat: 'jpeg', supportsTransparency: false, enabled: false,
      },
      {
        id: 'custom-banner', version: 1, platform: 'custom', usage: 'banner',
        label: '自定义横幅', width: 1600, height: 900,
        recommendedFormat: 'png', supportsTransparency: true, enabled: true,
      },
    ]);

    const enabled = await listEnabledPlatformExportPresets();

    expect(enabled.every(item => item.enabled)).toBe(true);
    expect(enabled).toContainEqual(expect.objectContaining({ id: 'custom-banner', version: 1 }));
    expect(enabled).not.toContainEqual(expect.objectContaining({ id: 'instagram-post' }));
  });

  it('changes only enabled state and preserves immutable preset fields', async () => {
    const before = await freezePlatformExportPresets(['instagram-post-v1']);

    await setPlatformExportPresetEnabled('instagram-post', 1, false);

    expect(mocks.dbSetPlatformExportPresetEnabled).toHaveBeenCalledWith(before[0], false);
    await expect(listAllPlatformExportPresets()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'instagram-post', width: 1080 })]),
    );
  });

  it('rejects unknown or malformed frozen references', async () => {
    await expect(freezePlatformExportPresets(['missing-v1'])).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_NOT_FOUND',
    });
    await expect(freezePlatformExportPresets(['instagram-post'])).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_REFERENCE_INVALID',
    });
  });
});
