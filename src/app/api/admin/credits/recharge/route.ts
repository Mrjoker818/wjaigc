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
    const { userId, amount, description } = body;

    if (!userId || !amount || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: '无效的用户ID或充值金额' }, { status: 400 });
    }

    const numericAmount = Math.floor(Number(amount));
    const now = Date.now();
    const desc = description || '管理员充值';

    // Verify user exists
    const userCheck = await execSql(
      `SELECT id FROM wujie_users WHERE id = $1`,
      [userId]
    );
    if ((userCheck.rows as any[]).length === 0) {
      return NextResponse.json({ success: false, error: `用户 ${userId} 不存在` }, { status: 404 });
    }

    // Upsert credits: create if not exists, update if exists
    await execSql(
      `INSERT INTO wujie_credits (user_id, balance, total_recharged, total_used, created_at, updated_at)
       VALUES ($1, $2, $2, 0, $3, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET balance = wujie_credits.balance + $2,
           total_recharged = wujie_credits.total_recharged + $2,
           updated_at = $3`,
      [userId, numericAmount, now]
    );

    // Record transaction
    const txId = `tx_${now}_${Math.random().toString(36).slice(2, 8)}`;
    await execSql(
      `INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, description, created_at)
       VALUES ($1, $2, 'recharge', $3, (SELECT balance FROM wujie_credits WHERE user_id = $2), $4, $5)`,
      [txId, userId, numericAmount, desc, now]
    );

    // Get updated balance
    const balanceRes = await execSql(
      `SELECT balance FROM wujie_credits WHERE user_id = $1`,
      [userId]
    );
    const newBalance = Number((balanceRes.rows as any[])[0]?.balance) || 0;

    return NextResponse.json({
      success: true,
      message: `充值 ${numericAmount} 积分成功`,
      newBalance,
    });
  } catch (error) {
    console.error('[admin/credits/recharge] POST error:', error);
    return NextResponse.json({ success: false, error: '充值失败: ' + (error instanceof Error ? error.message : String(error)) }, { status: 500 });
  }
}
