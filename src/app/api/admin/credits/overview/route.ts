import { NextRequest, NextResponse } from 'next/server';
import { listManagedUsers, requireAdminUser } from '@/lib/server-auth';
import { execSql, isDatabaseConfigured } from '@/lib/db-client';

export const dynamic = 'force-dynamic';

interface CreditSummaryRow { total_balance?: unknown; total_recharged?: unknown; total_consumed?: unknown; total_users?: unknown; avg_per_user?: unknown; }
interface CreditDistributionRow {
  image_consumed?: unknown;
  chat_consumed?: unknown;
  video_consumed?: unknown;
  other_consumed?: unknown;
  refunded?: unknown;
  recharged?: unknown;
  compensated?: unknown;
}
interface CreditUserRow { user_id: string; name?: string; balance?: unknown; total_recharged?: unknown; actual_recharged?: unknown; total_used?: unknown; }
interface CreditTransactionRow {
  user_id: string;
  user?: string;
  type?: string;
  amount?: unknown;
  desc?: string;
  created_at?: unknown;
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function allocateWholePercentages(values: number[]): string[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => '0%');

  const exact = values.map(value => value / total * 100);
  const whole = exact.map(Math.floor);
  let remainder = 100 - whole.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - whole[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const item of order) {
    if (remainder <= 0) break;
    whole[item.index] += 1;
    remainder -= 1;
  }
  return whole.map(value => `${value}%`);
}

function emptyCreditsOverview(users: Array<{ id: string; name: string }> = []) {
  return {
    success: true,
    totalBalance: 0,
    totalRecharged: 0,
    totalConsumed: 0,
    totalUsers: users.length,
    avgPerUser: 0,
    flows: { consumed: 0, refunded: 0, recharged: 0, compensated: 0 },
    distribution: [
      { label: '图像生成', value: 0, color: '#d4af37', pct: '0%' },
      { label: 'AI 对话', value: 0, color: '#22c55e', pct: '0%' },
      { label: '视频生成', value: 0, color: '#3b82f6', pct: '0%' },
      { label: '其他', value: 0, color: '#a1a1aa', pct: '0%' },
    ],
    topUsers: users.map(user => ({
      userId: user.id,
      name: user.name,
      consumed: 0,
      totalConsumed: 0,
      balance: 0,
      totalRecharged: 0,
    })),
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

    const managedUsers = await listManagedUsers();

    if (!isDatabaseConfigured()) {
      return NextResponse.json(emptyCreditsOverview(managedUsers));
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
        `WITH normalized AS (
           SELECT type, amount, LOWER(COALESCE(description, '')) AS normalized_description
           FROM wujie_credit_transactions
         ), categorized AS (
           SELECT type, amount,
             CASE WHEN type = 'consume' AND amount < 0 THEN
               CASE
                 WHEN normalized_description ~ '(视频|video)' THEN 'video'
                 WHEN normalized_description ~ '(聊天|chat|对话)' THEN 'chat'
                 WHEN normalized_description ~ '(生图|图像|image|生成|编辑|放大|背景|修图|矢量|svg|描摹)' THEN 'image'
                 ELSE 'other'
               END
             ELSE NULL END AS category
           FROM normalized
         )
         SELECT
           COALESCE(SUM(CASE WHEN category = 'image' THEN ABS(amount) ELSE 0 END), 0) as image_consumed,
           COALESCE(SUM(CASE WHEN category = 'chat' THEN ABS(amount) ELSE 0 END), 0) as chat_consumed,
           COALESCE(SUM(CASE WHEN category = 'video' THEN ABS(amount) ELSE 0 END), 0) as video_consumed,
           COALESCE(SUM(CASE WHEN category = 'other' THEN ABS(amount) ELSE 0 END), 0) as other_consumed,
           COALESCE(SUM(CASE WHEN type = 'refund' AND amount > 0 THEN amount ELSE 0 END), 0) as refunded,
           COALESCE(SUM(CASE WHEN type = 'recharge' AND amount > 0 THEN amount ELSE 0 END), 0) as recharged,
           COALESCE(SUM(CASE WHEN type = 'admin_adjust' AND amount > 0 THEN amount ELSE 0 END), 0) as compensated
         FROM categorized`
      ),
      execSql(
        `SELECT c.user_id, u.name, c.balance, c.total_recharged, c.total_used,
                COALESCE(SUM(CASE WHEN t.type = 'recharge' AND t.amount > 0 THEN t.amount ELSE 0 END), 0) AS actual_recharged
         FROM wujie_credits c
         LEFT JOIN wujie_users u ON c.user_id = u.id
         LEFT JOIN wujie_credit_transactions t ON t.user_id = c.user_id
         GROUP BY c.user_id, u.name, c.balance, c.total_recharged, c.total_used
         ORDER BY c.total_used DESC`
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
    const distributionValues = [
      toNonNegativeNumber(dist.image_consumed),
      toNonNegativeNumber(dist.chat_consumed),
      toNonNegativeNumber(dist.video_consumed),
      toNonNegativeNumber(dist.other_consumed),
    ];
    const distributionPercentages = allocateWholePercentages(distributionValues);
    const categorizedConsumed = distributionValues.reduce((sum, value) => sum + value, 0);

    const distribution = [
      { label: '图像生成', value: distributionValues[0], color: '#d4af37', pct: distributionPercentages[0] },
      { label: 'AI 对话', value: distributionValues[1], color: '#22c55e', pct: distributionPercentages[1] },
      { label: '视频生成', value: distributionValues[2], color: '#3b82f6', pct: distributionPercentages[2] },
      { label: '其他', value: distributionValues[3], color: '#a1a1aa', pct: distributionPercentages[3] },
    ];

    const creditsByUserId = new Map(
      (topUsersRes.rows as unknown as CreditUserRow[]).map(row => [row.user_id, row]),
    );
    const topUsers = managedUsers
      .map(user => {
        const credit = creditsByUserId.get(user.id);
        return {
          userId: user.id,
          name: user.name,
          consumed: Number(credit?.total_used) || 0,
          totalConsumed: Number(credit?.total_used) || 0,
          balance: Number(credit?.balance) || 0,
          totalRecharged: Number(credit?.actual_recharged ?? credit?.total_recharged) || 0,
        };
      })
      .sort((a, b) => b.consumed - a.consumed);

    const recentTransactions = (recentTxRes.rows as unknown as CreditTransactionRow[]).map(r => {
      const desc = (r.desc || '').toLocaleLowerCase();
      const isVideo = desc.includes('视频') || desc.includes('video');
      const isChat = !isVideo && (desc.includes('聊天') || desc.includes('chat') || desc.includes('对话'));
      const isImage = !isVideo && !isChat && ['生图', '图像', 'image', '生成', '编辑', '放大', '背景', '修图', '矢量', 'svg', '描摹']
        .some(keyword => desc.includes(keyword));
      const transactionType = r.type === 'recharge'
        ? 'recharge'
        : r.type === 'refund'
          ? 'refund'
          : r.type === 'admin_adjust'
            ? Number(r.amount) >= 0 ? 'compensation' : 'adjustment'
            : r.type === 'consume'
              ? isVideo ? 'video' : isChat ? 'chat' : isImage ? 'image' : 'other'
              : 'other';
      const typeLabels: Record<string, string> = {
        recharge: '充值',
        refund: '退款',
        compensation: '补偿',
        adjustment: '扣减',
        image: '图像生成',
        video: '视频生成',
        chat: 'AI 对话',
        other: '其他消费',
      };
      return {
        user: r.user || r.user_id,
        type: transactionType,
        typeLabel: typeLabels[transactionType] || transactionType,
        direction: Number(r.amount) >= 0 ? 'credit' : 'debit',
        amount: Number(r.amount) || 0,
        desc: r.desc || '-',
        time: new Date(Number(r.created_at)).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      };
    });

    return NextResponse.json({
      success: true,
      totalBalance: Number(summary.total_balance) || 0,
      totalRecharged: toNonNegativeNumber(dist.recharged),
      totalConsumed: Number(summary.total_consumed) || 0,
      totalUsers: managedUsers.length,
      avgPerUser: managedUsers.length > 0
        ? (Number(summary.total_balance) || 0) / managedUsers.length
        : 0,
      flows: {
        consumed: categorizedConsumed,
        refunded: toNonNegativeNumber(dist.refunded),
        recharged: toNonNegativeNumber(dist.recharged),
        compensated: toNonNegativeNumber(dist.compensated),
      },
      distribution,
      topUsers,
      recentTransactions,
    });
  } catch (error) {
    console.error('[admin/credits/overview] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load credits overview' }, { status: 500 });
  }
}
