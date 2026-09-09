import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createPlatformExportPresetVersion: vi.fn(),
  listAllPlatformExportPresets: vi.fn(),
  requireAdminUser: vi.fn(),
  setPlatformExportPresetEnabled: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/multi-platform-export/presets', () => ({
  createPlatformExportPresetVersion: mocks.createPlatformExportPresetVersion,
  listAllPlatformExportPresets: mocks.listAllPlatformExportPresets,
  setPlatformExportPresetEnabled: mocks.setPlatformExportPresetEnabled,
}));

import { GET, PATCH, POST } from '@/app/api/admin/platform-export-presets/route';

const validPreset = {
  id: 'custom-banner',
  platform: 'custom',
  usage: 'banner',
  label: '自定义横幅',
  width: 1600,
  height: 900,
  recommendedFormat: 'png',
  supportsTransparency: true,
  enabled: true,
};

function request(method: 'GET' | 'POST' | 'PATCH', body?: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/admin/platform-export-presets', {
    method,
    ...(body ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : {}),
  });
}

describe('/api/admin/platform-export-presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.listAllPlatformExportPresets.mockResolvedValue([]);
    mocks.createPlatformExportPresetVersion.mockResolvedValue({ ...validPreset, version: 1 });
    mocks.setPlatformExportPresetEnabled.mockResolvedValue({ ...validPreset, version: 1, enabled: false });
  });

  it('rejects non-administrators before reading or writing presets', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    for (const handler of [GET, POST, PATCH]) {
      const method = handler === GET ? 'GET' : handler === POST ? 'POST' : 'PATCH';
      const response = await handler(request(method, method === 'GET' ? undefined : validPreset));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false, code: 'ADMIN_REQUIRED' });
    }
    expect(mocks.listAllPlatformExportPresets).not.toHaveBeenCalled();
    expect(mocks.createPlatformExportPresetVersion).not.toHaveBeenCalled();
    expect(mocks.setPlatformExportPresetEnabled).not.toHaveBeenCalled();
  });

  it('returns all historical versions and their enabled state to administrators', async () => {
    mocks.listAllPlatformExportPresets.mockResolvedValue([
      { ...validPreset, version: 1, enabled: false },
      { ...validPreset, version: 2, width: 1920, enabled: true },
    ]);

    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, presets: expect.any(Array) });
  });

  it('creates a new version through a strictly validated request', async () => {
    const response = await POST(request('POST', validPreset));

    expect(response.status).toBe(201);
    expect(mocks.createPlatformExportPresetVersion).toHaveBeenCalledWith(validPreset);
  });

  it('returns a structured error when persistence cannot create the version', async () => {
    mocks.createPlatformExportPresetVersion.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(request('POST', validPreset));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      code: 'PLATFORM_EXPORT_PRESET_WRITE_FAILED',
      error: 'Unable to create platform export preset version',
    });
  });

  it.each([
    [{ ...validPreset, width: 0 }],
    [{ ...validPreset, height: 8193 }],
    [{ ...validPreset, platform: 'p'.repeat(65) }],
    [{ ...validPreset, usage: 'u'.repeat(65) }],
    [{ ...validPreset, label: 'l'.repeat(121) }],
    [{ ...validPreset, recommendedFormat: 'gif' }],
    [{ ...validPreset, unexpected: true }],
  ])('rejects invalid or undeclared creation fields', async body => {
    const response = await POST(request('POST', body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'PLATFORM_EXPORT_PRESET_INVALID' });
    expect(mocks.createPlatformExportPresetVersion).not.toHaveBeenCalled();
  });

  it('patches only the enabled state of an exact historical version', async () => {
    const response = await PATCH(request('PATCH', {
      presetId: 'custom-banner',
      version: 1,
      enabled: false,
    }));

    expect(response.status).toBe(200);
    expect(mocks.setPlatformExportPresetEnabled).toHaveBeenCalledWith('custom-banner', 1, false);
  });

  it('rejects immutable field updates through PATCH', async () => {
    const response = await PATCH(request('PATCH', {
      presetId: 'custom-banner',
      version: 1,
      enabled: false,
      width: 800,
    }));

    expect(response.status).toBe(400);
    expect(mocks.setPlatformExportPresetEnabled).not.toHaveBeenCalled();
  });
});
