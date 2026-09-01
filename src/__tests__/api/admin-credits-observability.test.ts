import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
  execSql: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: mocks.requireAdminUser,
  listManagedUsers: mocks.listManagedUsers,
}));
vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));

import { GET } from '@/app/api/admin/credits/overview/route';

const admin = { id: 'admin-1', name: 'Admin', role: 'admin', status: 'active' };

function mockOverviewQueries(recentTransactions: unknown[] = []) {
  mocks.execSql
    .mockResolvedValueOnce({
      rows: [{
        total_balance: 900,
        total_recharged: 1_020,
        total_consumed: 100,
        total_users: 1,
        avg_per_user: 900,
      }],
    })
    .mockResolvedValueOnce({
      rows: [{
        image_consumed: 100,
        chat_consumed: 37,
        video_consumed: 0,
        other_consumed: 0,
        refunded: 37,
        recharged: 1_000,
        compensated: 20,
      }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: recentTransactions });
}

describe('admin credit observability', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireAdminUser.mockResolvedValue(admin);
    mocks.listManagedUsers.mockResolvedValue([admin]);
    mocks.isDatabaseConfigured.mockReturnValue(true);
  });

  it('uses the categorized consumption total as the percentage denominator', async () => {
    mockOverviewQueries();

    const response = await GET(new NextRequest('http://localhost/api/admin/credits/overview'));
    const body = await response.json();
    const percentages = body.distribution.map((item: { pct: string }) => Number.parseInt(item.pct, 10));

    expect(response.status).toBe(200);
    expect(percentages.every((value: number) => value >= 0 && value <= 100)).toBe(true);
    expect(percentages.reduce((sum: number, value: number) => sum + value, 0)).toBe(100);
    expect(body.flows).toEqual({
      consumed: 137,
      refunded: 37,
      recharged: 1_000,
      compensated: 20,
    });
    expect(body.totalRecharged).toBe(1_000);
  });

  it('classifies only consume transactions once and treats null descriptions as other', async () => {
    mockOverviewQueries();

    await GET(new NextRequest('http://localhost/api/admin/credits/overview'));
    const distributionSql = String(mocks.execSql.mock.calls[1]?.[0] || '');

    expect(distributionSql).toContain("type = 'consume'");
    expect(distributionSql).toContain("LOWER(COALESCE(description, ''))");
    expect(distributionSql).toContain("WHEN normalized_description ~ '(视频|video)' THEN 'video'");
    expect(distributionSql).toContain("WHEN normalized_description ~ '(聊天|chat|对话)' THEN 'chat'");
    expect(distributionSql).toContain("ELSE 'other'");
  });

  it('does not report refunds or administrator compensation as recharge', async () => {
    mockOverviewQueries([
      { user_id: 'u1', user: 'Alice', type: 'recharge', amount: 100, desc: '套餐充值', created_at: 1_700_000_000_000 },
      { user_id: 'u1', user: 'Alice', type: 'refund', amount: 10, desc: '图像生成失败退款', created_at: 1_700_000_000_001 },
      { user_id: 'u1', user: 'Alice', type: 'admin_adjust', amount: 20, desc: '服务补偿', created_at: 1_700_000_000_002 },
      { user_id: 'u1', user: 'Alice', type: 'consume', amount: -5, desc: 'AI聊天', created_at: 1_700_000_000_003 },
      { user_id: 'u1', user: 'Alice', type: 'consume', amount: -6, desc: 'IMAGE编辑', created_at: 1_700_000_000_004 },
      { user_id: 'u1', user: 'Alice', type: 'consume', amount: -7, desc: 'VIDEO CHAT', created_at: 1_700_000_000_005 },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/admin/credits/overview'));
    const body = await response.json();

    expect(body.recentTransactions.map((item: { type: string; typeLabel: string; direction: string }) => ({
      type: item.type,
      typeLabel: item.typeLabel,
      direction: item.direction,
    }))).toEqual([
      { type: 'recharge', typeLabel: '充值', direction: 'credit' },
      { type: 'refund', typeLabel: '退款', direction: 'credit' },
      { type: 'compensation', typeLabel: '补偿', direction: 'credit' },
      { type: 'chat', typeLabel: 'AI 对话', direction: 'debit' },
      { type: 'image', typeLabel: '图像生成', direction: 'debit' },
      { type: 'video', typeLabel: '视频生成', direction: 'debit' },
    ]);
  });
});
