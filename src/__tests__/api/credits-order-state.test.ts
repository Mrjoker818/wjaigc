import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  execSql: vi.fn(),
  dbGetCredits: vi.fn(),
  dbAdjustCredits: vi.fn(),
  dbGetCreditTransactions: vi.fn(),
  dbGetAllCredits: vi.fn(),
  dbInitCredits: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql }));
vi.mock('@/lib/db-storage', () => ({
  dbGetCredits: mocks.dbGetCredits,
  dbAdjustCredits: mocks.dbAdjustCredits,
  dbGetCreditTransactions: mocks.dbGetCreditTransactions,
  dbGetAllCredits: mocks.dbGetAllCredits,
  dbInitCredits: mocks.dbInitCredits,
}));

import { POST } from '@/app/api/credits/route';

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/credits order state protection', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.getSessionUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  });

  it('does not reject an order unless it is waiting for manual review', async () => {
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });

    const response = await POST(request({ action: 'admin-reject', orderId: 'paid-order' }));

    expect(response.status).toBe(409);
    expect(mocks.execSql).toHaveBeenCalledWith(
      expect.stringContaining("payment_status IN ('pending', 'submitted', 'pending_paid')"),
      expect.any(Array),
    );
  });

  it('does not deduct credits when another administrator already claimed a reversal', async () => {
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });

    const response = await POST(request({ action: 'reverse-order', orderId: 'already-reversing' }));

    expect(response.status).toBe(409);
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
    expect(mocks.execSql).toHaveBeenCalledWith(
      expect.stringContaining("payment_status = 'reversing'"),
      expect.any(Array),
    );
  });

  it('does not confirm an order that has already been reversed', async () => {
    mocks.execSql.mockResolvedValue({
      rows: [{ payment_status: 'reversed', amount: 100, user_id: 'user-1' }],
      rowCount: 1,
    });

    const response = await POST(request({ action: 'admin-confirm', orderId: 'reversed-order' }));

    expect(response.status).toBe(409);
    expect(mocks.dbAdjustCredits).not.toHaveBeenCalled();
  });
});
