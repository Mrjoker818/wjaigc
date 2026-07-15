import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { execSql } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

type QueryRow = Record<string, unknown>;

function getRowString(row: QueryRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function getRowNumber(row: QueryRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    // Aggregate credit stats
    const [summaryRes, distributionRes, topUsersRes, recentTxRes] = await Promise.all([
      execSql(
        `SELECT COALESCE(SUM(balance), 0) as total_balance,
                COALESCE(SUM(total_recharged), 0) as total_recharged,
                COALESCE(SUM(total_used), 0) as total_consumed,
                COUNT(*) as total_users,
                CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(balance), 0) / COUNT(*) ELSE 0 END as avg_per_user
         FROM wujie_credits`
      ),
      execSql(
        `SELECT
           COALESCE(SUM(CASE WHEN description LIKE '%生图%' OR description LIKE '%image%' OR description LIKE '%生成%' THEN ABS(amount) ELSE 0 END), 0) as image_consumed,
           COALESCE(SUM(CASE WHEN description LIKE '%聊天%' OR description LIKE '%chat%' OR description LIKE '%对话%' THEN ABS(amount) ELSE 0 END), 0) as chat_consumed,
           COALESCE(SUM(CASE WHEN description LIKE '%视频%' OR description LIKE '%video%' THEN ABS(amount) ELSE 0 END), 0) as video_consumed,
           COALESCE(SUM(CASE WHEN description NOT LIKE '%生图%' AND description NOT LIKE '%image%' AND description NOT LIKE '%生成%' AND description NOT LIKE '%聊天%' AND description NOT LIKE '%chat%' AND description NOT LIKE '%对话%' AND description NOT LIKE '%视频%' AND description NOT LIKE '%video%' AND amount < 0 THEN ABS(amount) ELSE 0 END), 0) as other_consumed
         FROM wujie_credit_transactions WHERE amount < 0`
      ),
      execSql(
        `SELECT c.user_id, u.name, c.balance, c.total_recharged, c.total_used
         FROM wujie_credits c
         LEFT JOIN wujie_users u ON c.user_id = u.id
         ORDER BY c.total_used DESC
         LIMIT 10`
      ),
      execSql(
        `SELECT t.user_id, u.name as user, t.type, t.amount, t.description as desc, t.created_at
         FROM wujie_credit_transactions t
         LEFT JOIN wujie_users u ON t.user_id = u.id
         ORDER BY t.created_at DESC
         LIMIT 50`
      ),
    ]);

    const summary = (summaryRes.rows as QueryRow[])[0] || {};
    const dist = (distributionRes.rows as QueryRow[])[0] || {};
    const totalConsumed = getRowNumber(summary, 'total_consumed') || 1;

    const distribution = [
      { label: '图像生成', value: getRowNumber(dist, 'image_consumed'), color: '#d4af37', pct: `${Math.round(getRowNumber(dist, 'image_consumed') / totalConsumed * 100)}%` },
      { label: 'AI 对话', value: getRowNumber(dist, 'chat_consumed'), color: '#22c55e', pct: `${Math.round(getRowNumber(dist, 'chat_consumed') / totalConsumed * 100)}%` },
      { label: '视频生成', value: getRowNumber(dist, 'video_consumed'), color: '#3b82f6', pct: `${Math.round(getRowNumber(dist, 'video_consumed') / totalConsumed * 100)}%` },
      { label: '其他', value: getRowNumber(dist, 'other_consumed'), color: '#a1a1aa', pct: `${Math.round(getRowNumber(dist, 'other_consumed') / totalConsumed * 100)}%` },
    ];

    const topUsers = (topUsersRes.rows as QueryRow[]).map(row => ({
      userId: getRowString(row, 'user_id'),
      name: getRowString(row, 'name') || getRowString(row, 'user_id'),
      consumed: getRowNumber(row, 'total_used'),
      totalConsumed: getRowNumber(row, 'total_used'),
      balance: getRowNumber(row, 'balance'),
      totalRecharged: getRowNumber(row, 'total_recharged'),
    }));

    const recentTransactions = (recentTxRes.rows as QueryRow[]).map(row => {
      const description = getRowString(row, 'desc');
      const amount = getRowNumber(row, 'amount');
      return {
        user: getRowString(row, 'user') || getRowString(row, 'user_id'),
        type: amount > 0 ? 'recharge' : description.includes('生图') || description.includes('生成') ? 'image' : description.includes('视频') ? 'video' : description.includes('聊天') || description.includes('chat') ? 'chat' : 'other',
        amount,
        desc: description || '-',
        time: new Date(getRowNumber(row, 'created_at')).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      };
    });

    return NextResponse.json({
      success: true,
      totalBalance: getRowNumber(summary, 'total_balance'),
      totalRecharged: getRowNumber(summary, 'total_recharged'),
      totalConsumed: getRowNumber(summary, 'total_consumed'),
      totalUsers: getRowNumber(summary, 'total_users'),
      avgPerUser: getRowNumber(summary, 'avg_per_user'),
      distribution,
      topUsers,
      recentTransactions,
    });
  } catch (error) {
    console.error('[admin/credits/overview] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load credits overview' }, { status: 500 });
  }
}
