import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetCredits, dbAdjustCredits, dbGetCreditTransactions, dbGetAllCredits, dbInitCredits } from '@/lib/db-storage';
import { execSql } from '@/lib/db-client';

/**
 * GET /api/credits
 * - User: get own credits balance
 * - Admin with ?all=true: get all users' credits
 * - Admin with ?action=admin-overview: get all users' credits with user names
 * - Admin with ?userId=xxx: get specific user's credits
 * - ?transactions=true or ?action=transactions: get transaction history
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const isAdmin = user.role === 'admin';
    const action = searchParams.get('action');
    const wantAll = searchParams.get('all') === 'true';
    const wantTransactions = searchParams.get('transactions') === 'true' || action === 'transactions';
    const targetUserId = searchParams.get('userId') || user.id;
    const txType = searchParams.get('type') || undefined;
    const txLimit = parseInt(searchParams.get('limit') || '50', 10);
    const txOffset = parseInt(searchParams.get('offset') || '0', 10);

    // Admin overview: all users with credits and names
    if (action === 'admin-overview' && isAdmin) {
      const allCredits = await dbGetAllCredits();
      // Fetch all users for name mapping
      let usersData: Array<{ id: string; name: string }> = [];
      try {
        const result = await execSql('SELECT id, name FROM wujie_users');
        usersData = result.rows as Array<{ id: string; name: string }>;
      } catch { /* ignore */ }
      const nameMap = new Map(usersData.map(u => [u.id, u.name]));
      const overview = allCredits.map(c => ({
        userId: c.user_id,
        userName: nameMap.get(c.user_id) || c.user_id,
        balance: c.balance,
        totalRecharged: c.total_recharged,
        totalUsed: c.total_used,
      }));
      // Also add users without credits records
      for (const u of usersData) {
        if (!overview.find(o => o.userId === u.id)) {
          overview.push({ userId: u.id, userName: u.name, balance: 0, totalRecharged: 0, totalUsed: 0 });
        }
      }
      return NextResponse.json({ success: true, users: overview });
    }

    // Admin: get all users' credits
    if (wantAll && isAdmin) {
      const allCredits = await dbGetAllCredits();
      return NextResponse.json({ success: true, credits: allCredits });
    }

    // Non-admin can only query own data
    const effectiveUserId = isAdmin ? targetUserId : user.id;

    // Get transactions
    if (wantTransactions) {
      const transactions = await dbGetCreditTransactions(effectiveUserId, {
        type: txType,
        limit: txLimit,
        offset: txOffset,
      });
      return NextResponse.json({
        success: true,
        transactions: transactions.map(tx => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          balanceAfter: tx.balance_after,
          description: tx.description,
          createdAt: tx.created_at,
        })),
      });
    }

    // Get credits balance
    let credits = await dbGetCredits(effectiveUserId);
    if (!credits) {
      credits = await dbInitCredits(effectiveUserId);
    }

    return NextResponse.json({
      success: true,
      credits: credits ? {
        userId: credits.user_id,
        balance: credits.balance,
        totalRecharged: credits.total_recharged,
        totalUsed: credits.total_used,
      } : { userId: effectiveUserId, balance: 0, totalRecharged: 0, totalUsed: 0 },
    });
  } catch (e) {
    console.error('[credits] GET error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST /api/credits
 * - User: recharge (add credits to own account)
 * - Admin: adjust any user's credits
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { action, amount, description, userId: targetUserId, packageName } = body as {
      action: 'recharge' | 'admin_adjust' | 'admin-recharge';
      amount?: number;
      description?: string;
      userId?: string;
      packageName?: string;
    };

    const isAdmin = user.role === 'admin';

    if (action === 'recharge') {
      // User self-recharge
      const rechargeAmount = amount || 0;
      if (rechargeAmount <= 0) {
        return NextResponse.json({ success: false, error: '充值金额必须大于0' }, { status: 400 });
      }

      const desc = description || `充值 ${rechargeAmount} 积分${packageName ? ` (${packageName})` : ''}`;
      const result = await dbAdjustCredits(user.id, rechargeAmount, 'recharge', desc);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.message || '充值失败' }, { status: 400 });
      }
      return NextResponse.json({ success: true, balance: result.balance, message: '充值成功' });
    }

    if ((action === 'admin_adjust' || action === 'admin-recharge') && isAdmin) {
      // Admin adjust/recharge credits for any user
      const effectiveUserId = targetUserId || user.id;
      const adjustAmount = amount || 0;
      if (adjustAmount === 0) {
        return NextResponse.json({ success: false, error: '调整数量不能为0' }, { status: 400 });
      }

      const desc = description || `管理员调整 ${adjustAmount > 0 ? '+' : ''}${adjustAmount} 积分`;
      const result = await dbAdjustCredits(effectiveUserId, adjustAmount, 'admin_adjust', desc);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.message || '调整失败' }, { status: 400 });
      }
      return NextResponse.json({ success: true, balance: result.balance, message: '调整成功' });
    }

    return NextResponse.json({ success: false, error: '无效操作' }, { status: 400 });
  } catch (e) {
    console.error('[credits] POST error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
