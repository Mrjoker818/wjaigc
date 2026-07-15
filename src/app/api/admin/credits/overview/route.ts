import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';
import { execSql } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

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

    const summary = (summaryRes.rows as any[])[0] || {};
    const dist = (distributionRes.rows as any[])[0] || {};
    const totalConsumed = Number(summary.total_consumed) || 1;

    const distribution = [
      { label: '图像生成', value: Number(dist.image_consumed) || 0, color: '#d4af37', pct: `${Math.round((Number(dist.image_consumed) || 0) / totalConsumed * 100)}%` },
      { label: 'AI 对话', value: Number(dist.chat_consumed) || 0, color: '#22c55e', pct: `${Math.round((Number(dist.chat_consumed) || 0) / totalConsumed * 100)}%` },
      { label: '视频生成', value: Number(dist.video_consumed) || 0, color: '#3b82f6', pct: `${Math.round((Number(dist.video_consumed) || 0) / totalConsumed * 100)}%` },
      { label: '其他', value: Number(dist.other_consumed) || 0, color: '#a1a1aa', pct: `${Math.round((Number(dist.other_consumed) || 0) / totalConsumed * 100)}%` },
    ];

    const topUsers = (topUsersRes.rows as any[]).map(r => ({
      userId: r.user_id,
      name: r.name || r.user_id,
      consumed: Number(r.total_used) || 0,
      totalConsumed: Number(r.total_used) || 0,
      balance: Number(r.balance) || 0,
      totalRecharged: Number(r.total_recharged) || 0,
    }));

    const recentTransactions = (recentTxRes.rows as any[]).map(r => ({
      user: r.user || r.user_id,
      type: r.amount > 0 ? 'recharge' : (r.desc || '').includes('生图') || (r.desc || '').includes('生成') ? 'image' : (r.desc || '').includes('视频') ? 'video' : (r.desc || '').includes('聊天') || (r.desc || '').includes('chat') ? 'chat' : 'other',
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
