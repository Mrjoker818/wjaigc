import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { execSql } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, amount } = body;

    if (!userId || !amount || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid userId or amount' }, { status: 400 });
    }

    const numericAmount = Math.floor(Number(amount));
    const now = Date.now();

    // Update credits balance
    await execSql(
      `UPDATE wujie_credits SET balance = balance + $1, total_recharged = total_recharged + $1, updated_at = $2 WHERE user_id = $3`,
      [numericAmount, now, userId]
    );

    // Record transaction
    const txId = `tx_${now}_${Math.random().toString(36).slice(2, 8)}`;
    await execSql(
      `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, created_at)
       VALUES ($1, $2, 'recharge', $3, (SELECT balance FROM wujie_credits WHERE user_id = $2), '管理员充值', $4)`,
      [txId, userId, numericAmount, now]
    );

    return NextResponse.json({ success: true, message: `充值 ${numericAmount} 积分成功` });
  } catch (error) {
    console.error('[admin/credits/recharge] POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to recharge credits' }, { status: 500 });
  }
}
