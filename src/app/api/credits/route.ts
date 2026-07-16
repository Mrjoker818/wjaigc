import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetCredits, dbAdjustCredits, dbGetCreditTransactions, dbGetAllCredits, dbInitCredits } from '@/lib/db-storage';
import { execSql, isDatabaseConfigured } from '@/lib/db-client';
import { CREDITS_TO_CNY, CNY_TO_CREDITS, IMAGE_MODEL_CREDITS, VIDEO_MODEL_CREDITS, CHAT_MODEL_CREDITS, RECHARGE_PACKAGES, getModelPricingInfo } from '@/lib/credits';
import { getPaymentStatus } from '@/lib/payment-config';

type RechargeOrder = {
  order_id: string;
  user_id: string;
  username: string;
  amount_yuan: number;
  credits: number;
  payment_method: 'wechat' | 'alipay';
  status: 'pending' | 'submitted' | 'paid' | 'cancelled' | 'rejected';
  created_at: string;
  paid_at: string | null;
  credited_at: string | null;
  payment_note: string | null;
};

/**
 * GET /api/credits
 * - User: get own credits balance
 * - Admin with ?all=true: get all users' credits
 * - Admin with ?action=admin-overview: get all users' credits with user names
 * - Admin with ?userId=xxx: get specific user's credits
 * - ?transactions=true or ?action=transactions: get transaction history
 * - Admin with ?action=pending-orders: get pending orders awaiting confirmation
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

    // Admin: get self-confirmed orders for audit (auto-credited, admin can reverse fraudulent ones)
    if (action === 'audit-orders' && isAdmin) {
      if (!isDatabaseConfigured()) {
        return NextResponse.json({ success: true, orders: [], storageUnavailable: true });
      }
      try {
        const status = searchParams.get('status') || 'all';
        let statusFilter = '';
        if (status === 'confirmed') statusFilter = "AND o.payment_status = 'paid'";
        else if (status === 'reversed') statusFilter = "AND o.payment_status = 'reversed'";
        else statusFilter = "AND o.payment_status IN ('paid', 'reversed')";

        const result = await execSql(
          `SELECT o.id, o.user_id, o.amount, o.price_cny, o.bonus, o.payment_method, o.payment_status, o.created_at, o.paid_at, o.updated_at, u.name as user_name
           FROM wujie_recharge_orders o
           LEFT JOIN wujie_users u ON o.user_id = u.id
           WHERE 1=1 ${statusFilter}
           ORDER BY o.created_at DESC
           LIMIT 200`
        );
        return NextResponse.json({
          success: true,
          orders: result.rows.map((row: Record<string, unknown>) => ({
            id: row.id,
            userId: row.user_id,
            userName: row.user_name || row.user_id,
            amount: row.amount,
            priceCny: row.price_cny,
            bonus: row.bonus,
            paymentMethod: row.payment_method,
            status: row.payment_status,
            createdAt: row.created_at,
            paidAt: row.paid_at,
            updatedAt: row.updated_at,
          })),
        });
      } catch (dbErr) {
        console.error('[credits] audit orders error:', dbErr);
        return NextResponse.json({ success: false, error: '查询订单失败' }, { status: 500 });
      }
    }

    // Admin: get pending orders for confirmation
    if (action === 'pending-orders' && isAdmin) {
      if (!isDatabaseConfigured()) {
        return NextResponse.json({ success: true, orders: [], storageUnavailable: true });
      }
      try {
        const result = await execSql(
          `SELECT o.id, o.user_id, o.amount, o.price_cny, o.bonus, o.payment_method, o.payment_status, o.created_at, o.submitted_at, o.expires_at, u.name as user_name
           FROM wujie_recharge_orders o
           LEFT JOIN wujie_users u ON o.user_id = u.id
           WHERE o.payment_status IN ('submitted', 'pending_paid')
           ORDER BY o.created_at DESC
           LIMIT 100`
        );
        return NextResponse.json({
          success: true,
          orders: result.rows.map((row: Record<string, unknown>) => ({
            id: row.id,
            userId: row.user_id,
            userName: row.user_name || row.user_id,
            amount: row.amount,
            priceCny: row.price_cny,
            bonus: row.bonus,
            paymentMethod: row.payment_method,
            status: row.payment_status,
            createdAt: row.created_at,
            submittedAt: row.submitted_at,
            expiresAt: row.expires_at,
          })),
        });
      } catch (dbErr) {
        console.error('[credits] pending orders error:', dbErr);
        return NextResponse.json({ success: false, error: '查询订单失败' }, { status: 500 });
      }
    }

    // Admin overview: all users with credits and names
    if (action === 'admin-overview' && isAdmin) {
      const allCredits = await dbGetAllCredits();
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
      pricing: {
        creditsToCNY: CREDITS_TO_CNY,
        cnyToCredits: CNY_TO_CREDITS,
        imageModels: Object.fromEntries(
          Object.entries(IMAGE_MODEL_CREDITS).map(([k, v]) => [k, { credits: v.credits, label: v.label, cny: (v.credits * CREDITS_TO_CNY).toFixed(2) }])
        ),
        videoModels: Object.fromEntries(
          Object.entries(VIDEO_MODEL_CREDITS).map(([k, v]) => [k, { creditsPerSecond: v.creditsPerSecond, label: v.label, cnyPerSecond: (v.creditsPerSecond * CREDITS_TO_CNY).toFixed(2) }])
        ),
        chatModels: Object.fromEntries(
          Object.entries(CHAT_MODEL_CREDITS).map(([k, v]) => [k, { creditsPerCall: v.creditsPerCall, label: v.label, cny: (v.creditsPerCall * CREDITS_TO_CNY).toFixed(2) }])
        ),
        rechargePackages: RECHARGE_PACKAGES,
      },
    });
  } catch (e) {
    console.error('[credits] GET error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST /api/credits
 * - action=create-order: User creates a recharge order (show QR code, user pays manually)
 * - action=query-order: User queries order status
 * - action=confirm-paid: User confirms they've paid (submits for admin review, NO auto-credits)
 * - action=admin-confirm: Admin confirms payment received → adds credits, marks paid
 * - action=admin-reject: Admin rejects an order (marks as rejected)
 * - action=reverse-order: Admin reverses a self-confirmed order (deducts credits back)
 * - action=admin_adjust / action=admin-recharge: Admin adjusts any user's credits
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { action, amount, description, userId: targetUserId, packageName, paymentMethod, orderId, status, reason } = body as {
      action: 'create-order' | 'query-order' | 'confirm-paid' | 'admin-confirm' | 'admin-confirm-paid' | 'admin-reject' | 'reverse-order' | 'admin_adjust' | 'admin-recharge' | 'my-orders' | 'admin-all-orders';
      amount?: number;
      description?: string;
      userId?: string;
      packageName?: string;
      paymentMethod?: 'alipay' | 'wechat';
      orderId?: string;
      status?: string;
      reason?: string;
    };

    const isAdmin = user.role === 'admin';

    // ===== User: Create recharge order (QR code mode) =====
    if (action === 'create-order') {
      const rechargeAmount = amount || 0;
      if (rechargeAmount <= 0) {
        return NextResponse.json({ success: false, error: '充值数量必须大于0' }, { status: 400 });
      }
      const method = paymentMethod || 'wechat';
      if (method !== 'alipay' && method !== 'wechat') {
        return NextResponse.json({ success: false, error: '不支持的支付方式' }, { status: 400 });
      }

      // Read server-side payment configuration directly, without a loopback HTTP request.
      const paymentStatusData = await getPaymentStatus();
      if (!paymentStatusData.canRecharge) {
        return NextResponse.json({
          success: false,
          error: '收款码暂未配置，请联系管理员在后台上传收款码后才能充值。',
          errorCode: 'PAYMENT_NOT_CONFIGURED',
        }, { status: 400 });
      }
      if (method === 'wechat' && !paymentStatusData.status?.wechat) {
        return NextResponse.json({ success: false, error: '微信收款码暂未配置' }, { status: 400 });
      }
      if (method === 'alipay' && !paymentStatusData.status?.alipay) {
        return NextResponse.json({ success: false, error: '支付宝收款码暂未配置' }, { status: 400 });
      }

      // Validate amount matches a package
      const pkg = RECHARGE_PACKAGES.find(p => p.amount === rechargeAmount);
      const priceCny = pkg ? pkg.price : rechargeAmount * CREDITS_TO_CNY;
      const bonusCredits = pkg ? pkg.bonus : 0;

      // Create order in database
      const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const nowTs = Date.now();
      const expiresAt = nowTs + 24 * 60 * 60 * 1000; // 24 hours expiry

      try {
        await execSql(
          `INSERT INTO wujie_recharge_orders (id, user_id, amount, price_cny, bonus, payment_method, payment_status, created_at, updated_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)`,
          [orderId, user.id, rechargeAmount + bonusCredits, priceCny, bonusCredits, method, nowTs, nowTs, expiresAt]
        );
      } catch (dbErr) {
        console.error('[credits] create order error:', dbErr);
        return NextResponse.json({ success: false, error: '创建订单失败' }, { status: 500 });
      }

      // Return order info with QR code URL
      const qrUrl = method === 'wechat' ? paymentStatusData.qrUrls?.wechat : paymentStatusData.qrUrls?.alipay;

      return NextResponse.json({
        success: true,
        orderId,
        amount: rechargeAmount + bonusCredits,
        priceCny,
        bonusCredits,
        paymentMethod: method,
        expiresAt,
        qrUrl,
        note: paymentStatusData.note || '',
      });
    }

    // ===== User: Query order status =====
    if (action === 'query-order') {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
      }
      try {
        const result = await execSql(
          'SELECT * FROM wujie_recharge_orders WHERE id = $1 AND user_id = $2',
          [orderId, user.id]
        );
        if (result.rows.length === 0) {
          return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
        }
        const r = result.rows[0] as Record<string, unknown>;
        return NextResponse.json({
          success: true,
          order: {
            orderId: r.id,
            amount: Number(r.amount) || 0,
            priceCny: Number(r.price_cny) || 0,
            bonus: Number(r.bonus) || 0,
            paymentMethod: r.payment_method,
            paymentStatus: r.payment_status === 'failed' ? 'rejected' : r.payment_status,
            rejectReason: r.admin_note || r.payment_note || null,
            createdAt: Number(r.created_at) || 0,
            paidAt: r.paid_at ? Number(r.paid_at) : undefined,
          },
        });
      } catch (dbErr) {
        console.error('[credits] query-order error:', dbErr);
        return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
      }
    }

    // ===== User: Confirm they've paid (submits for admin review, NO auto-credit) =====
    if (action === 'confirm-paid') {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
      }
      try {
        // Verify order belongs to this user and is in 'pending' state
        const result = await execSql(
          'SELECT * FROM wujie_recharge_orders WHERE id = $1 AND user_id = $2',
          [orderId, user.id]
        );
        if (result.rows.length === 0) {
          return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
        }
        const order = result.rows[0] as Record<string, unknown>;
        if (order.payment_status === 'paid') {
          return NextResponse.json({ success: true, message: '订单已到账', alreadyPaid: true });
        }
        if (order.payment_status === 'submitted') {
          return NextResponse.json({ success: true, message: '已提交付款确认，等待管理员审核', alreadySubmitted: true });
        }
        if (order.payment_status !== 'pending') {
          return NextResponse.json({ success: false, error: '订单状态不正确' }, { status: 400 });
        }

        // Submit for admin review - DO NOT add credits immediately
        const nowTs = Date.now();
        await execSql(
          `UPDATE wujie_recharge_orders SET payment_status = 'submitted', submitted_at = $2, updated_at = $3 WHERE id = $1`,
          [orderId, nowTs, nowTs]
        );

        return NextResponse.json({
          success: true,
          message: '付款确认已提交，管理员审核通过后积分将自动到账，通常1-10分钟内处理完成',
          submitted: true,
        });
      } catch (dbErr) {
        console.error('[credits] confirm paid error:', dbErr);
        return NextResponse.json({ success: false, error: '提交失败' }, { status: 500 });
      }
    }

    // ===== Admin: Confirm an order (add credits) =====
    // Alias: 'admin-confirm' or 'admin-confirm-paid'
    if ((action === 'admin-confirm' || action === 'admin-confirm-paid') && isAdmin) {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
      }
      try {
        // Use SELECT FOR UPDATE to prevent concurrent admin-confirm race condition
        const result = await execSql(
          'SELECT * FROM wujie_recharge_orders WHERE id = $1 FOR UPDATE',
          [orderId]
        );
        if (result.rows.length === 0) {
          return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
        }
        const order = result.rows[0] as Record<string, unknown>;
        if (order.payment_status === 'paid') {
          return NextResponse.json({ success: false, error: '订单已处理' }, { status: 400 });
        }
        if (!['pending', 'submitted', 'pending_paid'].includes(String(order.payment_status))) {
          return NextResponse.json({ success: false, error: '订单不是可确认到账的待审核状态' }, { status: 409 });
        }

        // Add credits to user
        const orderAmount = Number(order.amount) || 0;
        const userId = order.user_id as string;
        const adjustResult = await dbAdjustCredits(userId, orderAmount, 'recharge', `充值 ${orderAmount} 积分（订单${orderId}）`);

        if (!adjustResult.success) {
          return NextResponse.json({ success: false, error: '积分到账失败' }, { status: 500 });
        }

        // Update order status atomically with status check to prevent double-confirm
        const nowTs2 = Date.now();
        const updateResult = await execSql(
          `UPDATE wujie_recharge_orders SET payment_status = 'paid', paid_at = $2, updated_at = $3 WHERE id = $1 AND payment_status != 'paid'`,
          [orderId, nowTs2, nowTs2]
        );
        if ((updateResult.rowCount ?? 0) === 0) {
          // Order was already confirmed by another admin concurrently, reverse the credit
          await dbAdjustCredits(userId, -orderAmount, 'admin_adjust', `并发确认回退（订单${orderId}）`);
          return NextResponse.json({ success: false, error: '订单已被其他管理员处理' }, { status: 409 });
        }

        return NextResponse.json({ success: true, message: '订单已确认，积分已到账' });
      } catch (dbErr) {
        console.error('[credits] admin confirm error:', dbErr);
        return NextResponse.json({ success: false, error: '确认失败' }, { status: 500 });
      }
    }

    // ===== Admin: Reject an order =====
    if (action === 'admin-reject' && isAdmin) {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
      }
      try {
        const rejectReason = reason || '未收到对应款项';
        const rejectResult = await execSql(
          `UPDATE wujie_recharge_orders
           SET payment_status = 'rejected', payment_note = $2, updated_at = $3
           WHERE id = $1 AND payment_status IN ('pending', 'submitted', 'pending_paid')`,
          [orderId, rejectReason, Date.now()]
        );
        if ((rejectResult.rowCount ?? 0) === 0) {
          return NextResponse.json({ success: false, error: '订单不是待审核状态，无法驳回' }, { status: 409 });
        }
        return NextResponse.json({ success: true, message: '订单已驳回' });
      } catch (dbErr) {
        console.error('[credits] admin reject error:', dbErr);
        return NextResponse.json({ success: false, error: '操作失败' }, { status: 500 });
      }
    }

    // ===== Admin: Reverse a self-confirmed order (deduct credits back) =====
    if (action === 'reverse-order' && isAdmin) {
      if (!orderId) {
        return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
      }
      const reason = (body as Record<string, unknown>).reason as string || '管理员撤销：未收到付款';
      try {
        // Claim the paid order before touching credits so concurrent admins cannot deduct twice.
        const claimResult = await execSql(
          `UPDATE wujie_recharge_orders
           SET payment_status = 'reversing', updated_at = $2
           WHERE id = $1 AND payment_status = 'paid'
           RETURNING user_id, amount`,
          [orderId, Date.now()]
        );
        if ((claimResult.rowCount ?? 0) === 0 || claimResult.rows.length === 0) {
          return NextResponse.json({ success: false, error: '订单不是可撤销的已到账状态，或正在被其他管理员处理' }, { status: 409 });
        }
        const order = claimResult.rows[0] as Record<string, unknown>;

        // Deduct credits from user
        const orderAmount = Number(order.amount) || 0;
        const targetUser = order.user_id as string;
        const deductResult = await dbAdjustCredits(targetUser, -orderAmount, 'admin_adjust', `${reason}（撤销订单${orderId}）`);

        if (!deductResult.success) {
          await execSql(
            `UPDATE wujie_recharge_orders SET payment_status = 'paid', updated_at = $2 WHERE id = $1 AND payment_status = 'reversing'`,
            [orderId, Date.now()]
          );
          return NextResponse.json({ success: false, error: '扣除积分失败: ' + (deductResult.message || '') }, { status: 500 });
        }

        // Update order status to reversed
        const finishResult = await execSql(
          `UPDATE wujie_recharge_orders SET payment_status = 'reversed', updated_at = $2 WHERE id = $1 AND payment_status = 'reversing'`,
          [orderId, Date.now()]
        );
        if ((finishResult.rowCount ?? 0) === 0) {
          return NextResponse.json({ success: false, error: '撤销积分已扣除，但订单状态更新失败，请在审计记录中人工处理' }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: '订单已撤销，积分已扣回', balance: deductResult.balance });
      } catch (dbErr) {
        console.error('[credits] reverse order error:', dbErr);
        return NextResponse.json({ success: false, error: '撤销失败' }, { status: 500 });
      }
    }

    // ===== Admin: Adjust credits =====
    if ((action === 'admin_adjust' || action === 'admin-recharge') && isAdmin) {
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

    // ===== User: My orders =====
    if (action === 'my-orders' && user) {
      if (!isDatabaseConfigured()) {
        return NextResponse.json({ success: true, orders: [], storageUnavailable: true });
      }
      try {
        const res = await execSql(
          'SELECT * FROM wujie_recharge_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
          [user.id]
        );
        return NextResponse.json({ success: true, orders: res?.rows || [] });
      } catch (dbErr) {
        console.error('[credits] my-orders error:', dbErr);
        return NextResponse.json({ success: false, error: '查询订单失败' }, { status: 500 });
      }
    }

    // ===== Admin: All orders (for review) =====
    if (action === 'admin-all-orders' && isAdmin) {
      const statusFilter = typeof status === 'string' ? status : '';
      try {
        let res;
        const validStatuses = ['pending', 'submitted', 'paid', 'rejected', 'failed', 'cancelled', 'reversing', 'reversed'];
        if (statusFilter && validStatuses.includes(statusFilter)) {
          res = await execSql(
            `SELECT o.*, u.name as username
             FROM wujie_recharge_orders o
             LEFT JOIN wujie_users u ON o.user_id = u.id
             WHERE o.payment_status = $1
             ORDER BY o.created_at DESC LIMIT 100`,
            [statusFilter]
          );
        } else {
          res = await execSql(
            `SELECT o.*, u.name as username
             FROM wujie_recharge_orders o
             LEFT JOIN wujie_users u ON o.user_id = u.id
             ORDER BY o.created_at DESC LIMIT 100`
          );
        }
        return NextResponse.json({
          success: true,
          orders: (res?.rows || []).map((r: Record<string, unknown>) => ({
            orderId: r.id,
            userId: r.user_id,
            username: r.username || r.user_id,
            amount: Number(r.price_cny) || 0,
            credits: Number(r.amount) || 0,
            priceCny: Number(r.price_cny) || 0,
            bonus: Number(r.bonus) || 0,
            paymentMethod: r.payment_method,
            status: r.payment_status === 'failed' ? 'rejected' : r.payment_status,
            createdAt: Number(r.created_at) || 0,
            paidAt: r.paid_at ? Number(r.paid_at) : undefined,
            remark: r.payment_note as string | null,
          })),
        });
      } catch (dbErr) {
        console.error('[credits] admin-all-orders error:', dbErr);
        return NextResponse.json({ success: false, error: '查询订单失败' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: false, error: '无效操作' }, { status: 400 });
  } catch (e) {
    console.error('[credits] POST error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
