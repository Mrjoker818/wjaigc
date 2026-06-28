import { NextRequest, NextResponse } from 'next/server';
import { execSql } from '@/lib/db-client';
import { dbAdjustCredits, dbGetSystemSetting } from '@/lib/db-storage';

/**
 * GET /api/recharge/[orderId]
 * Public: get order details for the recharge page (no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
    }

    // Get order
    const result = await execSql(
      'SELECT * FROM wujie_recharge_orders WHERE id = $1',
      [orderId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    const order = result.rows[0] as Record<string, unknown>;
    const method = order.payment_method as string;

    // Check expiry
    const expiresAt = Number(order.expires_at) || 0;
    const isExpired = expiresAt > 0 && Date.now() > expiresAt;

    // Get admin payment config (note + QR code for payment)
    let note = '';
    let adminQrUrl = '';
    try {
      const dbVal = await dbGetSystemSetting('payment_config');
      if (dbVal) {
        const config = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal as Record<string, unknown>;
        note = (config.note as string) || '';
        // Return the QR URL matching the payment method
        if (method === 'wechat' && config.wechatEnabled && config.wechatQrUrl) {
          adminQrUrl = config.wechatQrUrl as string;
        } else if (method === 'alipay' && config.alipayEnabled && config.alipayQrUrl) {
          adminQrUrl = config.alipayQrUrl as string;
        }
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        amount: Number(order.amount) || 0,
        priceCny: Number(order.price_cny) || 0,
        bonus: Number(order.bonus) || 0,
        paymentMethod: method,
        paymentStatus: order.payment_status,
        createdAt: Number(order.created_at) || 0,
        expiresAt: Number(order.expires_at) || 0,
        isExpired,
      },
      adminQrUrl,
      note,
    });
  } catch (e) {
    console.error('[recharge] GET error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST /api/recharge/[orderId]
 * Public: user confirms payment on the recharge page (no auth required, orderId is the token)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ success: false, error: '缺少订单号' }, { status: 400 });
    }

    // Get order
    const result = await execSql(
      'SELECT * FROM wujie_recharge_orders WHERE id = $1',
      [orderId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: '订单不存在' }, { status: 404 });
    }

    const order = result.rows[0] as Record<string, unknown>;

    // Already paid
    if (order.payment_status === 'paid') {
      return NextResponse.json({ success: true, message: '订单已到账', alreadyPaid: true });
    }

    // Not pending
    if (order.payment_status !== 'pending') {
      return NextResponse.json({ success: false, error: '订单状态不正确' }, { status: 400 });
    }

    // Check expiry
    const expiresAt = Number(order.expires_at) || 0;
    if (expiresAt > 0 && Date.now() > expiresAt) {
      return NextResponse.json({ success: false, error: '订单已过期' }, { status: 400 });
    }

    // Auto-credit: add credits to user's account
    const userId = order.user_id as string;
    const orderAmount = Number(order.amount) || 0;
    const adjustResult = await dbAdjustCredits(userId, orderAmount, 'recharge', `扫码充值 ${orderAmount} 积分（订单${orderId}）`);

    if (!adjustResult.success) {
      return NextResponse.json({ success: false, error: '积分到账失败，请稍后重试' }, { status: 500 });
    }

    // Update order status to paid
    await execSql(
      `UPDATE wujie_recharge_orders SET payment_status = 'paid', paid_at = $2, updated_at = $3 WHERE id = $1`,
      [orderId, Date.now(), Date.now()]
    );

    return NextResponse.json({
      success: true,
      message: '充值成功！积分已到账',
      balance: adjustResult.balance,
      amount: orderAmount,
    });
  } catch (e) {
    console.error('[recharge] POST confirm error:', e);
    const errorMsg = e instanceof Error ? e.message : '确认失败';
    return NextResponse.json({ success: false, error: `确认失败: ${errorMsg}` }, { status: 500 });
  }
}
