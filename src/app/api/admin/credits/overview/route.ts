import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { execSql, isDatabaseConfigured } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

interface CreditSummaryRow { total_balance?: unknown; total_recharged?: unknown; total_consumed?: unknown; total_users?: unknown; avg_per_user?: unknown; }
interface CreditDistributionRow { image_consumed?: unknown; chat_consumed?: unknown; video_consumed?: unknown; other_consumed?: unknown; }
interface CreditUserRow { user_id: string; name?: string; balance?: unknown; total_recharged?: unknown; total_used?: unknown; }
interface CreditTransactionRow { user_id: string; user?: string; amount?: unknown; desc?: string; created_at?: unknown; }

function emptyCreditsOverview() {
  return {
    success: true,
    totalBalance: 0,
    totalRecharged: 0,
    totalConsumed: 0,
    totalUsers: 0,
    avgPerUser: 0,
    distribution: [
      { label: '图像生成', value: 0, color: '#d4af37', pct: '0%' },
      { label: 'AI 对话', value: 0, color: '#22c55e', pct: '0%' },
      { label: '视频生成', value: 0, color: '#3b82f6', pct: '0%' },
      { label: '其他', value: 0, color: '#a1a1aa', pct: '0%' },
    ],
    topUsers: [],
    recentTransactions: [],
    storageUnavailable: true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminUser(request);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    if (!isDatabaseConfigured()) {
      return NextResponse.json(emptyCreditsOverview());
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

    const summary = ((summaryRes.rows as CreditSummaryRow[])[0] || {});
    const dist = ((distributionRes.rows as CreditDistributionRow[])[0] || {});
    const totalConsumed = Number(summary.total_consumed) || 1;

    const distribution = [
      { label: '图像生成', value: Number(dist.image_consumed) || 0, color: '#d4af37', pct: `${Math.round((Number(dist.image_consumed) || 0) / totalConsumed * 100)}%` },
      { label: 'AI 对话', value: Number(dist.chat_consumed) || 0, color: '#22c55e', pct: `${Math.round((Number(dist.chat_consumed) || 0) / totalConsumed * 100)}%` },
      { label: '视频生成', value: Number(dist.video_consumed) || 0, color: '#3b82f6', pct: `${Math.round((Number(dist.video_consumed) || 0) / totalConsumed * 100)}%` },
      { label: '其他', value: Number(dist.other_consumed) || 0, color: '#a1a1aa', pct: `${Math.round((Number(dist.other_consumed) || 0) / totalConsumed * 100)}%` },
    ];

    const topUsers = (topUsersRes.rows as unknown as CreditUserRow[]).map(r => ({
      userId: r.user_id,
      name: r.name || r.user_id,
      consumed: Number(r.total_used) || 0,
      totalConsumed: Number(r.total_used) || 0,
      balance: Number(r.balance) || 0,
      totalRecharged: Number(r.total_recharged) || 0,
    }));

    const recentTransactions = (recentTxRes.rows as unknown as CreditTransactionRow[]).map(r => ({
      user: r.user || r.user_id,
      type: Number(r.amount) > 0 ? 'recharge' : (r.desc || '').includes('生图') || (r.desc || '').includes('生成') ? 'image' : (r.desc || '').includes('视频') ? 'video' : (r.desc || '').includes('聊天') || (r.desc || '').includes('chat') ? 'chat' : 'other',
      amount: Number(r.amount) || 0,
      desc: r.desc || '-',
      time: new Date(Number(r.created_at)).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    }));

    return NextResponse.json({
      success: true,
      totalBalance: Number(summary.total_balance) || 0,
      totalRecharged: Number(summary.total_recharged) || 0,
      totalConsumed: Number(summary.total_consumed) || 0,
      totalUsers: Number(summary.total_users) || 0,
      avgPerUser: Number(summary.avg_per_user) || 0,
      distribution,
      topUsers,
      recentTransactions,
    });
  } catch (error) {
    console.error('[admin/credits/overview] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load credits overview' }, { status: 500 });
  }
}
