import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireAdminUser: vi.fn(),
  execSql: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  dbGetSystemSetting: vi.fn(),
  dbSetSystemSetting: vi.fn(),
  dbAddAuditLog: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetSystemSetting: mocks.dbGetSystemSetting,
  dbSetSystemSetting: mocks.dbSetSystemSetting,
  dbAddAuditLog: mocks.dbAddAuditLog,
}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.getApiProviders }));

import { GET as getCredits } from '@/app/api/credits/route';
import { GET as getCreditsOverview } from '@/app/api/admin/credits/overview/route';
import { GET as getRechargeOrder } from '@/app/api/recharge/[orderId]/route';
import {
  listBackups,
  listDesktopDevices,
  listGenerationRecords,
  listResources,
  readDesktopUpdateConfig,
} from '@/lib/desktop-cloud';

describe('local mode database fallbacks', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.isDatabaseConfigured.mockReturnValue(false);
    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  });

  it('keeps administrator read-only credit views available without a database', async () => {
    const [auditResponse, overviewResponse] = await Promise.all([
      getCredits(new NextRequest('http://localhost/api/credits?action=audit-orders')),
      getCreditsOverview(new NextRequest('http://localhost/api/admin/credits/overview')),
    ]);

    expect(auditResponse.status).toBe(200);
    expect(await auditResponse.json()).toMatchObject({ success: true, orders: [], storageUnavailable: true });
    expect(overviewResponse.status).toBe(200);
    expect(await overviewResponse.json()).toMatchObject({
      success: true,
      totalBalance: 0,
      topUsers: [],
      recentTransactions: [],
      storageUnavailable: true,
    });
    expect(mocks.execSql).not.toHaveBeenCalled();
  });

  it('returns empty desktop read models without attempting to create cloud tables', async () => {
    await expect(Promise.all([
      listResources(),
      listBackups(),
      listDesktopDevices(),
      listGenerationRecords(),
      readDesktopUpdateConfig(),
    ])).resolves.toEqual([
      [],
      [],
      [],
      [],
      { enabled: false, version: '', packageUrl: '', sha256: '', size: 0, mandatory: false, notes: '', publishedAt: 0 },
    ]);
    expect(mocks.execSql).not.toHaveBeenCalled();
  });

  it('returns an explicit service-unavailable response for recharge orders without a database', async () => {
    const response = await getRechargeOrder(
      new NextRequest('http://localhost/api/recharge/test-order'),
      { params: Promise.resolve({ orderId: 'test-order' }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, storageUnavailable: true });
    expect(mocks.execSql).not.toHaveBeenCalled();
  });
});
