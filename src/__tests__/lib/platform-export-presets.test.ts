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
    mocks.dbCreatePlatformExportPresetVersion.mockImplementation(async preset => ({ ...preset, version: 2 }));
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
      expect.objectContaining({ id: 'instagram-post', width: 1200 }),
      1,
    );
  });

  it('returns all enabled versions in the public catalog', async () => {
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
    expect(enabled).toContainEqual(expect.objectContaining({ id: 'instagram-post', version: 1 }));
    expect(enabled).not.toContainEqual(expect.objectContaining({ id: 'instagram-post', version: 2 }));
  });

  it('returns every enabled version and can re-enable an exact historical version', async () => {
    mocks.dbListPlatformExportPresets.mockResolvedValue([
      {
        id: 'instagram-post', version: 1, platform: 'instagram', usage: 'post',
        label: 'Instagram 帖子', width: 1080, height: 1080,
        recommendedFormat: 'jpeg', supportsTransparency: false, enabled: true,
      },
      {
        id: 'instagram-post', version: 2, platform: 'instagram', usage: 'post',
        label: 'Instagram 帖子新版', width: 1200, height: 1200,
        recommendedFormat: 'jpeg', supportsTransparency: false, enabled: false,
      },
    ]);

    await expect(listEnabledPlatformExportPresets()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'instagram-post', version: 1 })]),
    );
    await setPlatformExportPresetEnabled('instagram-post', 1, true);
    expect(mocks.dbSetPlatformExportPresetEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'instagram-post', version: 1 }),
      true,
    );
  });

  it('fails closed when preset storage is unavailable', async () => {
    mocks.dbListPlatformExportPresets.mockRejectedValue(new Error('database unavailable'));

    await expect(listEnabledPlatformExportPresets()).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
    });
  });

  it('delegates version allocation atomically to storage without reading the current maximum', async () => {
    await createPlatformExportPresetVersion({
      id: 'custom-banner', platform: 'custom', usage: 'banner', label: '自定义横幅',
      width: 1600, height: 900, recommendedFormat: 'png', supportsTransparency: true, enabled: true,
    });

    expect(mocks.dbListPlatformExportPresets).not.toHaveBeenCalled();
    expect(mocks.dbCreatePlatformExportPresetVersion).toHaveBeenCalledWith(
      expect.not.objectContaining({ version: expect.anything() }),
      0,
    );
  });

  it('reserves built-in v1 when creating the first stored version and keeps the frozen default unchanged', async () => {
    mocks.dbCreatePlatformExportPresetVersion.mockResolvedValue({
      id: 'instagram-post', version: 2, platform: 'instagram', usage: 'post',
      label: 'Instagram 帖子新版', width: 1200, height: 1200,
      recommendedFormat: 'jpeg', supportsTransparency: false, enabled: true,
    });
    const before = await freezePlatformExportPresets(['instagram-post-v1']);

    await createPlatformExportPresetVersion({
      id: 'instagram-post', platform: 'instagram', usage: 'post', label: 'Instagram 帖子新版',
      width: 1200, height: 1200, recommendedFormat: 'jpeg', supportsTransparency: false, enabled: true,
    });

    expect(mocks.dbCreatePlatformExportPresetVersion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'instagram-post' }),
      1,
    );
    await expect(freezePlatformExportPresets(['instagram-post-v1'])).resolves.toEqual(before);
  });

  it('changes only enabled state and preserves immutable preset fields', async () => {
    const before = await freezePlatformExportPresets(['instagram-post-v1']);

    await setPlatformExportPresetEnabled('instagram-post', 1, false);

    expect(mocks.dbSetPlatformExportPresetEnabled).toHaveBeenCalledWith(before[0], false);
    await expect(listAllPlatformExportPresets()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'instagram-post', width: 1080 })]),
    );
  });

  it('preserves a named version conflict from an exact enabled-state update', async () => {
    mocks.dbSetPlatformExportPresetEnabled.mockRejectedValue(Object.assign(
      new Error('conflict'),
      { code: 'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT' },
    ));

    await expect(setPlatformExportPresetEnabled('instagram-post', 1, false)).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT',
    });
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
