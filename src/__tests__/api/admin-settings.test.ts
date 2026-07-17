import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  dbGetSystemSetting: vi.fn(),
  dbSetSystemSetting: vi.fn(),
  dbAddAuditLog: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/db-storage', () => ({
  dbGetSystemSetting: mocks.dbGetSystemSetting,
  dbSetSystemSetting: mocks.dbSetSystemSetting,
  dbAddAuditLog: mocks.dbAddAuditLog,
}));

import { POST } from '@/app/api/admin/settings/route';

describe('admin runtime settings', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockReset();
    mocks.dbGetSystemSetting.mockReset();
    mocks.dbSetSystemSetting.mockReset();
    mocks.dbAddAuditLog.mockReset();
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', name: 'Admin', role: 'admin' });
    mocks.dbSetSystemSetting.mockResolvedValue(undefined);
    mocks.dbAddAuditLog.mockResolvedValue(undefined);
  });

  it('persists only valid runtime-backed values', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ initialCredits: 80, videoGenerationEnabled: false, announcementType: 'banner' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.dbSetSystemSetting).toHaveBeenCalledWith('initialCredits', '80');
    expect(mocks.dbSetSystemSetting).toHaveBeenCalledWith('videoGenerationEnabled', 'false');
    expect(mocks.dbSetSystemSetting).toHaveBeenCalledWith('announcementType', 'banner');
  });

  it('rejects invalid values before saving', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ maxVideoDuration: 0 }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.dbSetSystemSetting).not.toHaveBeenCalled();
  });

  it('rejects a video duration above the 15 second platform maximum', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ maxVideoDuration: 16 }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.dbSetSystemSetting).not.toHaveBeenCalled();
  });
});
