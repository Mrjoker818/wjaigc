import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRuntimeSettings: vi.fn(),
  listEnabledPlatformExportPresets: vi.fn(),
}));

vi.mock('@/lib/runtime-settings', () => ({ getRuntimeSettings: mocks.getRuntimeSettings }));
vi.mock('@/lib/multi-platform-export/presets', () => ({
  listEnabledPlatformExportPresets: mocks.listEnabledPlatformExportPresets,
}));

import { GET } from '@/app/api/platform-export-presets/route';

describe('GET /api/platform-export-presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeSettings.mockResolvedValue({ multiPlatformExportEnabled: true });
    mocks.listEnabledPlatformExportPresets.mockResolvedValue([
      { id: 'instagram-post', version: 1, enabled: true },
    ]);
  });

  it('returns only the enabled public preset catalog when the feature is enabled', async () => {
    const response = await GET(new NextRequest('http://localhost/api/platform-export-presets'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      presets: [{ id: 'instagram-post', version: 1, enabled: true }],
    });
  });

  it('returns an empty catalog without reading presets when the feature defaults off', async () => {
    mocks.getRuntimeSettings.mockResolvedValue({ multiPlatformExportEnabled: false });

    const response = await GET(new NextRequest('http://localhost/api/platform-export-presets'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, presets: [] });
    expect(mocks.listEnabledPlatformExportPresets).not.toHaveBeenCalled();
  });

  it('fails closed with a structured response when preset storage is unavailable', async () => {
    mocks.listEnabledPlatformExportPresets.mockRejectedValue(Object.assign(
      new Error('database unavailable'),
      { code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE' },
    ));

    const response = await GET(new NextRequest('http://localhost/api/platform-export-presets'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
      error: 'Platform export presets are temporarily unavailable',
    });
  });
});
