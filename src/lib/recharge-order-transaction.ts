import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db-client';

type RechargeDecision = { kind: 'approve' } | { kind: 'reverse'; reason: string };

type SettlementResult =
  | { status: 'settled'; balance: number }
  | { status: 'not-found' | 'already-paid' | 'invalid-state' | 'insufficient-credits' };

interface OrderRow {
  user_id: string;
  amount: number;
  payment_status: string;
}

const REVIEW_STATES = ['pending', 'submitted', 'pending_paid'];

export async function settleRechargeOrder(orderId: string, decision: RechargeDecision): Promise<SettlementResult> {
  const client = await getPool().connect();
  let committed = false;
  try {
    // A competing decision must see the order's new status after waiting for this lock.
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const { rows: [order] } = await client.query<OrderRow>(
      'SELECT user_id, amount, payment_status FROM wujie_recharge_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (!order) return { status: 'not-found' };

    const reversing = decision.kind === 'reverse';
    if (reversing) {
      if (order.payment_status !== 'paid') return { status: 'invalid-state' };
    } else {
      if (order.payment_status === 'paid') return { status: 'already-paid' };
      if (!REVIEW_STATES.includes(order.payment_status)) return { status: 'invalid-state' };
    }

    const amount = Number(order.amount);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid recharge order amount');
    const now = Date.now();
    const delta = reversing ? -amount : amount;
    if (delta >= 0) {
      await client.query(
        `INSERT INTO wujie_credits (id, user_id, balance, total_recharged, total_used, created_at, updated_at)
         VALUES ($1, $2, 0, 0, 0, $3, $3) ON CONFLICT (user_id) DO NOTHING`,
        [`credits_${order.user_id}_${now}`, order.user_id, now],
      );
    }

    // The UPDATE locks the account and evaluates the deduction against its current balance.
    const updated = await client.query<{ balance: number }>(
      `UPDATE wujie_credits
       SET balance = balance + $2, total_recharged = total_recharged + $3,
           total_used = total_used + $4, updated_at = $5
       WHERE user_id = $1 AND ($2 >= 0 OR balance + $2 >= 0)
       RETURNING balance`,
      [order.user_id, delta, reversing ? 0 : amount, reversing ? amount : 0, now],
    );
    if (delta < 0 && updated.rowCount === 0) return { status: 'insufficient-credits' };
    if (updated.rowCount !== 1 || !updated.rows[0]) throw new Error('Recharge account update failed');
    const balance = Number(updated.rows[0].balance);
    if (!Number.isSafeInteger(balance)) throw new Error('Invalid recharge balance');

    const description = reversing
      ? `${decision.reason}（撤销订单${orderId}）`
      : `充值 ${amount} 积分（订单${orderId}）`;
    const entry = await client.query(
      `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, reference_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`tx_${now}_${randomUUID()}`, order.user_id, reversing ? 'admin_adjust' : 'recharge', delta, balance, description, null, now],
    );
    if (entry.rowCount !== 1) throw new Error('Recharge transaction record was not written');

    const finalOrder = await client.query(
      `UPDATE wujie_recharge_orders
       SET payment_status = $2, paid_at = CASE WHEN $2 = 'paid' THEN $3 ELSE paid_at END, updated_at = $3
       WHERE id = $1 AND payment_status = $4`,
      [orderId, reversing ? 'reversed' : 'paid', now, order.payment_status],
    );
    if (finalOrder.rowCount !== 1) throw new Error('Recharge order finalization failed');

    await client.query('COMMIT');
    committed = true;
    return { status: 'settled', balance };
  } finally {
    let discard = false;
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
    }
    client.release(discard);
  }
}
