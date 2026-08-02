import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
  dbGetUserData: vi.fn(),
  dbGetDashboardStats: vi.fn(),
  execSql: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  getApiProviders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
  listManagedUsers: mocks.listManagedUsers,
}));
vi.mock('@/lib/db-storage', () => ({
  dbGetUserData: mocks.dbGetUserData,
  dbGetDashboardStats: mocks.dbGetDashboardStats,
}));
vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: mocks.getApiProviders,
}));

import { GET as getCreditsOverview } from '@/app/api/admin/credits/overview/route';
import { GET as getDashboardStats } from '@/app/api/admin/dashboard-stats/route';
import { GET as getUserImages } from '@/app/api/admin/user-images/route';

const managedUsers = [
  { id: 'admin-1', name: 'Admin', role: 'admin', status: 'active' },
  { id: 'user-1', name: 'Alice', role: 'user', status: 'active' },
  { id: 'user-2', name: 'Bob', role: 'user', status: 'active' },
];

describe('admin user count consistency', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireAdminUser.mockResolvedValue(managedUsers[0]);
    mocks.listManagedUsers.mockResolvedValue(managedUsers);
    mocks.isDatabaseConfigured.mockReturnValue(true);
  });

  it('includes every managed user in credits even when some have no credit row', async () => {
    mocks.execSql
      .mockResolvedValueOnce({
        rows: [{
          total_balance: 50,
          total_recharged: 50,
          total_consumed: 0,
          total_users: 1,
          avg_per_user: 50,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ image_consumed: 0, chat_consumed: 0, video_consumed: 0, other_consumed: 0 }],
      })
      .mockResolvedValueOnce({
        rows: [{ user_id: 'user-1', name: 'Alice', balance: 50, total_recharged: 50, total_used: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await getCreditsOverview(
      new NextRequest('http://localhost/api/admin/credits/overview'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalUsers).toBe(managedUsers.length);
    expect(body.topUsers).toHaveLength(managedUsers.length);
    expect(body.topUsers).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'admin-1', name: 'Admin', balance: 0 }),
      expect.objectContaining({ userId: 'user-2', name: 'Bob', balance: 0 }),
    ]));
  });

  it('keeps users without projects in data management and preserves the global count while filtering', async () => {
    mocks.dbGetUserData.mockImplementation(async (userId: string) => (
      userId === 'user-1' ? [] : null
    ));

    const response = await getUserImages(
      new NextRequest('http://localhost/api/admin/user-images?userId=user-1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stats.totalUsers).toBe(managedUsers.length);
    expect(body.stats.filteredUsers).toBe(1);
    expect(body.stats.userStats).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        userName: 'Alice',
        totalImages: 0,
        projectCount: 0,
      }),
    ]);
  });

  it('uses the managed-user count in dashboard statistics and preserves the legacy stats envelope', async () => {
    mocks.dbGetDashboardStats.mockResolvedValue({
      totalUsers: 1,
      weekActive: 1,
      totalCredits: 50,
      creditsRecharged: 50,
      creditsConsumed: 0,
      todayGenerations: 0,
      totalApiCalls: 0,
      userTrend: [],
      creditTrend: [],
      modelRank: [],
      providerStatus: [],
      alerts: [],
      recentUsers: [],
    });
    mocks.getApiProviders.mockResolvedValue([]);

    const response = await getDashboardStats(
      new NextRequest('http://localhost/api/admin/dashboard-stats?period=7'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalUsers).toBe(managedUsers.length);
    expect(body.stats).toEqual(expect.objectContaining({
      totalUsers: managedUsers.length,
      totalCredits: 50,
    }));
  });
});
