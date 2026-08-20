import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
  dbGetDashboardStats: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
  listManagedUsers: mocks.listManagedUsers,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetDashboardStats: mocks.dbGetDashboardStats,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
}));

import { GET } from '@/app/api/admin/dashboard-stats/route';

function emptyStats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    totalUsers: 1,
    weekActive: 1,
    totalCredits: 100,
    creditsRecharged: 0,
    creditsConsumed: 0,
    todayGenerations: 0,
    totalApiCalls: 0,
    userTrend: [],
    creditTrend: [],
    modelRank: [],
    providerStatus: [],
    alerts: [],
    recentUsers: [],
    ...overrides,
  };
}

describe('admin dashboard metrics contract', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    mocks.listManagedUsers.mockResolvedValue([{ id: 'admin-1', role: 'admin' }]);
  });

  it('does not fabricate provider health or model success when usage metrics are absent', async () => {
    mocks.dbGetDashboardStats.mockResolvedValue(emptyStats());
    mocks.getApiProviders.mockResolvedValue([
      {
        id: 'pear',
        name: 'PearAPI',
        selectedModels: ['gpt-image-2'],
        balance: 80,
        balanceCurrency: 'USD',
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/admin/dashboard-stats?period=7'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.modelRank).toEqual([]);
    expect(body.providerStatus).toEqual([]);
    expect(body.metricsCoverage).toEqual({
      modelCalls: 'unavailable',
      providerCalls: 'unavailable',
    });
    expect(body.stats.metricsCoverage).toEqual(body.metricsCoverage);
  });

  it('filters provider configuration rows that do not contain real call metrics', async () => {
    mocks.dbGetDashboardStats.mockResolvedValue(emptyStats({
      providerStatus: [{ name: 'PearAPI', type: 'image', isEnabled: true }],
    }));
    mocks.getApiProviders.mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/admin/dashboard-stats?period=7'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providerStatus).toEqual([]);
    expect(body.metricsCoverage.providerCalls).toBe('unavailable');
  });

  it('preserves finite positive usage metrics and nullable success or failure rates', async () => {
    mocks.dbGetDashboardStats.mockResolvedValue(emptyStats({
      modelRank: [
        { name: 'gpt-image-2', calls: 12 },
        { name: 'invalid-zero', calls: 0, successRate: 100 },
      ],
      providerStatus: [
        { name: 'PearAPI', calls24h: 12, status: '正常' },
        { name: 'invalid-negative', calls24h: -1, failRate: 0, status: '正常' },
      ],
    }));
    mocks.getApiProviders.mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/admin/dashboard-stats?period=7'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.modelRank).toEqual([
      { name: 'gpt-image-2', calls: 12, successRate: null },
    ]);
    expect(body.providerStatus).toEqual([
      { name: 'PearAPI', calls24h: 12, failRate: null, status: '正常' },
    ]);
    expect(body.metricsCoverage).toEqual({
      modelCalls: 'available',
      providerCalls: 'available',
    });
  });
});
