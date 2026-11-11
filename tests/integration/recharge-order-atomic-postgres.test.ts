import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { ensureCoreTables } from '@/lib/db-storage';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('@/lib/server-auth', () => ({
  getSessionUser: async () => ({ id: 'test-admin', name: '测试管理员', role: 'admin' }),
}));

import { POST } from '@/app/api/credits/route';

function submit(action: string) {
  return POST(new NextRequest('http://localhost/api/credits', {
    method: 'POST',
    body: JSON.stringify({ action, orderId: 'synthetic-recharge' }),
  }));
}

it('commits each recharge and reversal once, and rolls back a refused ledger insert', async () => {
  await withIsolatedPostgres('recharge_atomic', async ({ query }) => {
    await ensureCoreTables();
    await query(
      `INSERT INTO wujie_recharge_orders
        (id, user_id, amount, price_cny, payment_method, payment_status, created_at, updated_at)
        VALUES ('synthetic-recharge', 'test-member', 25, 1, 'wechat', 'submitted', 1, 1)`,
    );
    await query("ALTER TABLE wujie_credit_transactions ADD CONSTRAINT test_reject_recharge CHECK (type <> 'recharge')");
    const refused = await submit('admin-confirm');
    expect(refused.status).toBe(500);
    expect((await query('SELECT payment_status FROM wujie_recharge_orders')).rows)
      .toEqual([{ payment_status: 'submitted' }]);
    expect((await query('SELECT balance FROM wujie_credits')).rows).toEqual([]);
    await query('ALTER TABLE wujie_credit_transactions DROP CONSTRAINT test_reject_recharge');

    const approvals = await Promise.all([submit('admin-confirm'), submit('admin-confirm-paid')]);
    expect(approvals.map(response => response.status).sort()).toEqual([200, 400]);
    expect((await query('SELECT balance FROM wujie_credits')).rows).toEqual([{ balance: 25 }]);
    expect((await query('SELECT payment_status FROM wujie_recharge_orders')).rows)
      .toEqual([{ payment_status: 'paid' }]);

    const reversals = await Promise.all([submit('reverse-order'), submit('reverse-order')]);
    expect(reversals.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await query('SELECT balance FROM wujie_credits')).rows).toEqual([{ balance: 0 }]);
    expect((await query('SELECT payment_status FROM wujie_recharge_orders')).rows)
      .toEqual([{ payment_status: 'reversed' }]);
    expect((await query('SELECT type, amount FROM wujie_credit_transactions ORDER BY amount DESC')).rows)
      .toEqual([{ type: 'recharge', amount: 25 }, { type: 'admin_adjust', amount: -25 }]);
  });
});
