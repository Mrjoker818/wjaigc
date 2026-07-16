import { NextRequest, NextResponse } from 'next/server';
import { execSql, isDatabaseConfigured } from '@/lib/db-client';
import { dbGetSystemSetting, dbSetSystemSetting } from '@/lib/db-storage';
import { decodeQrFromUrl, isPaymentLink } from '@/lib/qr-decode';

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

    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { success: false, error: '订单服务暂不可用，请稍后再试', storageUnavailable: true },
        { status: 503 },
      );
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

    // Get admin payment config (note + pay link for payment)
    let note = '';
    let payLink = '';
    let configSaved = false;
    try {
      const dbVal = await dbGetSystemSetting('payment_config');
      if (dbVal) {
        const config = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal as Record<string, unknown>;
        note = (config.note as string) || '';
        // Return the pay link matching the payment method (not QR image)
        if (method === 'wechat' && config.wechatEnabled && config.wechatPayLink) {
          payLink = config.wechatPayLink as string;
        } else if (method === 'alipay' && config.alipayEnabled && config.alipayPayLink) {
          payLink = config.alipayPayLink as string;
        }

        // Fallback: auto-decode QR code image on-the-fly if payLink is missing
        if (!payLink) {
          const qrUrl = method === 'wechat'
            ? (config.wechatQrUrl as string) || ''
            : (config.alipayQrUrl as string) || '';

          if (qrUrl) {
            console.log(`[recharge] payLink missing for ${method}, auto-decoding QR: ${qrUrl.substring(0, 60)}`);
            try {
              const decoded = await decodeQrFromUrl(qrUrl);
              if (decoded && isPaymentLink(decoded)) {
                payLink = decoded;
                console.log(`[recharge] Auto-decoded ${method} pay link: ${decoded.substring(0, 30)}...`);
                // Save back to config for future use
                const updatedConfig = { ...config };
                if (method === 'wechat') updatedConfig.wechatPayLink = decoded;
                else updatedConfig.alipayPayLink = decoded;
                if (!configSaved) {
                  await dbSetSystemSetting('payment_config', JSON.stringify(updatedConfig));
                  configSaved = true;
                }
              }
            } catch (decodeErr) {
              console.warn(`[recharge] Auto-decode failed for ${method}:`, decodeErr instanceof Error ? decodeErr.message : decodeErr);
            }
          }
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
        paymentStatus: order.payment_status === 'failed' ? 'rejected' : order.payment_status,
        createdAt: Number(order.created_at) || 0,
        expiresAt: Number(order.expires_at) || 0,
        isExpired,
        rejectReason: (order.payment_note as string) || null,
      },
      payLink,
      note,
      balance: null as number | null,
    });
  } catch (e) {
    console.error('[recharge] GET error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

/**
 * POST /api/recharge/[orderId]
 * Disabled: 直接加积分已废弃，统一走 /api/credits (confirm-paid → admin review)
 * 保留此端点返回410，防止旧前端调用造成漏洞。
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  await params; // satisfy params usage
  return NextResponse.json(
    { success: false, error: '此接口已停用，请通过 /api/credits 提交付款确认' },
    { status: 410 }
  );
}
