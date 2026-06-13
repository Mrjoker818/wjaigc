import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server-auth';
import { dbGetCredits, dbAdjustCredits, dbGetCreditTransactions, dbGetAllCredits, dbInitCredits, dbGetSystemSetting } from '@/lib/db-storage';
import { execSql } from '@/lib/db-client';
import { CREDITS_TO_CNY, CNY_TO_CREDITS, IMAGE_MODEL_CREDITS, VIDEO_MODEL_CREDITS, CHAT_MODEL_CREDITS, RECHARGE_PACKAGES, getModelPricingInfo } from '@/lib/credits';
import crypto from 'crypto';

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
 * - action=create-order: User creates a recharge order (pending payment)
 * - action=query-order: User queries order payment status
 * - action=admin_adjust / action=admin-recharge: Admin adjusts any user's credits
 * 
 * SECURITY: Users can NO longer directly add credits to their own account.
 * Credits can only be added through:
 * 1. Payment verification (Alipay/WeChat callback)
 * 2. Admin manual adjustment
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { action, amount, description, userId: targetUserId, packageName, paymentMethod, orderId } = body as {
      action: 'create-order' | 'query-order' | 'admin_adjust' | 'admin-recharge';
      amount?: number;
      description?: string;
      userId?: string;
      packageName?: string;
      paymentMethod?: 'alipay' | 'wechat';
      orderId?: string;
    };

    const isAdmin = user.role === 'admin';

    // ===== User: Create recharge order =====
    if (action === 'create-order') {
      const rechargeAmount = amount || 0;
      if (rechargeAmount <= 0) {
        return NextResponse.json({ success: false, error: '充值数量必须大于0' }, { status: 400 });
      }
      const method = paymentMethod || 'alipay';
      if (method !== 'alipay' && method !== 'wechat') {
        return NextResponse.json({ success: false, error: '不支持的支付方式' }, { status: 400 });
      }

      // Check payment is actually configured (no demo mode allowed)
      const paymentConfig = method === 'alipay' ? await getAlipayConfigFromDB() : await getWechatConfigFromDB();
      if (!paymentConfig.enabled) {
        return NextResponse.json({ 
          success: false, 
          error: `${method === 'alipay' ? '支付宝' : '微信'}支付暂未配置，请联系管理员在后台配置支付参数后才能充值。`,
          errorCode: 'PAYMENT_NOT_CONFIGURED',
        }, { status: 400 });
      }

      // Validate amount matches a package
      const pkg = RECHARGE_PACKAGES.find(p => p.amount === rechargeAmount);
      const priceCny = pkg ? pkg.price : rechargeAmount * CREDITS_TO_CNY;
      const bonusCredits = pkg ? pkg.bonus : 0;

      // Create order in database
      const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes expiry

      try {
        await execSql(
          `INSERT INTO wujie_recharge_orders (id, user_id, amount, price_cny, bonus, payment_method, payment_status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
          [orderId, user.id, rechargeAmount + bonusCredits, priceCny, bonusCredits, method, expiresAt]
        );
      } catch (dbErr) {
        console.error('[credits] create order error:', dbErr);
        return NextResponse.json({ success: false, error: '创建订单失败' }, { status: 500 });
      }

      // Generate payment parameters based on payment method
      const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'http://localhost:5000';
      const notifyUrl = `${domain.startsWith('http') ? domain : 'https://' + domain}/api/credits/payment-notify`;

      let paymentData: Record<string, unknown> = {};

      if (method === 'alipay') {
        paymentData = await createAlipayOrder({
          orderId,
          amount: priceCny,
          subject: `无界AI积分充值 - ${rechargeAmount}积分`,
          notifyUrl,
          returnUrl: `${domain.startsWith('http') ? domain : 'https://' + domain}`,
        });
      } else if (method === 'wechat') {
        paymentData = await createWechatOrder({
          orderId,
          amount: priceCny,
          description: `无界AI积分充值 - ${rechargeAmount}积分`,
          notifyUrl,
        });
      }

      return NextResponse.json({
        success: true,
        orderId,
        amount: rechargeAmount + bonusCredits,
        priceCny,
        bonusCredits,
        paymentMethod: method,
        expiresAt,
        paymentData,
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
        const order = result.rows[0] as Record<string, unknown>;
        return NextResponse.json({
          success: true,
          order: {
            id: order.id,
            amount: order.amount,
            priceCny: order.price_cny,
            bonus: order.bonus,
            paymentMethod: order.payment_method,
            paymentStatus: order.payment_status,
            tradeNo: order.trade_no,
            paidAt: order.paid_at,
            createdAt: order.created_at,
            expiresAt: order.expires_at,
          },
        });
      } catch (dbErr) {
        console.error('[credits] query order error:', dbErr);
        return NextResponse.json({ success: false, error: '查询订单失败' }, { status: 500 });
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

    return NextResponse.json({ success: false, error: '无效操作' }, { status: 400 });
  } catch (e) {
    console.error('[credits] POST error:', e);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

// ========== Alipay Integration ==========

interface AlipayConfig {
  enabled: boolean;
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gateway: string;
  notifyUrl: string;
}

async function getAlipayConfigFromDB(): Promise<AlipayConfig> {
  // Priority: DB config (payment_config key) > env vars
  try {
    const dbConfigRaw = await dbGetSystemSetting('payment_config');
    if (dbConfigRaw) {
      const parsed = typeof dbConfigRaw === 'string' ? JSON.parse(dbConfigRaw) : dbConfigRaw;
      const alipay = parsed.alipay;
      if (alipay && alipay.enabled) {
        return {
          enabled: true,
          appId: alipay.appId || '',
          privateKey: alipay.privateKey || '',
          alipayPublicKey: alipay.publicKey || '',
          gateway: alipay.sandbox ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do',
          notifyUrl: alipay.notifyUrl || '',
        };
      }
    }
  } catch { /* ignore DB read error */ }
  // Fallback to env vars
  return {
    enabled: !!(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY),
    appId: process.env.ALIPAY_APP_ID || '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
  };
}

async function createAlipayOrder(params: {
  orderId: string;
  amount: number;
  subject: string;
  notifyUrl: string;
  returnUrl: string;
}): Promise<Record<string, unknown>> {
  const config = await getAlipayConfigFromDB();
  const bizContent = {
    out_trade_no: params.orderId,
    total_amount: params.amount.toFixed(2),
    subject: params.subject,
    product_code: 'FAST_INSTANT_TRADE_PAY',
    timeout_express: '30m',
  };

  // Build sign params for Alipay
  const signParams: Record<string, string> = {
    app_id: config.appId,
    method: 'alipay.trade.page.pay',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0',
    notify_url: params.notifyUrl,
    return_url: params.returnUrl,
    biz_content: JSON.stringify(bizContent),
  };

  // In production, sign with RSA2 private key
  // For now, return the payment URL structure
  try {
    const crypto = await import('crypto');
    const signString = Object.keys(signParams)
      .filter(k => k !== 'sign' && signParams[k] !== '')
      .sort()
      .map(k => `${k}=${signParams[k]}`)
      .join('&');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signString, 'utf-8');
    const signature = sign.sign(config.privateKey, 'base64');
    signParams.sign = signature;

    const paymentUrl = `${config.gateway}?${Object.entries(signParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;

    return {
      mode: 'production',
      paymentUrl,
      orderId: params.orderId,
    };
  } catch (signErr) {
    console.error('[credits] alipay sign error:', signErr);
    return {
      mode: 'demo',
      message: '支付宝签名失败，请检查密钥配置',
      orderId: params.orderId,
      amount: params.amount,
    };
  }
}

// ========== WeChat Pay Integration ==========

interface WechatConfig {
  enabled: boolean;
  appId: string;
  mchId: string;
  apiKey: string;
  certPath: string;
  notifyUrl: string;
}

async function getWechatConfigFromDB(): Promise<WechatConfig> {
  // Priority: DB config (payment_config key) > env vars
  try {
    const dbConfigRaw = await dbGetSystemSetting('payment_config');
    if (dbConfigRaw) {
      const parsed = typeof dbConfigRaw === 'string' ? JSON.parse(dbConfigRaw) : dbConfigRaw;
      const wechat = parsed.wechat;
      if (wechat && wechat.enabled) {
        return {
          enabled: true,
          appId: wechat.appId || '',
          mchId: wechat.mchId || '',
          apiKey: wechat.apiKey || '',
          certPath: wechat.serialNo || '',
          notifyUrl: wechat.notifyUrl || '',
        };
      }
    }
  } catch { /* ignore DB read error */ }
  // Fallback to env vars
  return {
    enabled: !!(process.env.WECHAT_APP_ID && process.env.WECHAT_MCH_ID && process.env.WECHAT_API_KEY),
    appId: process.env.WECHAT_APP_ID || '',
    mchId: process.env.WECHAT_MCH_ID || '',
    apiKey: process.env.WECHAT_API_KEY || '',
    certPath: process.env.WECHAT_CERT_PATH || '',
    notifyUrl: process.env.WECHAT_NOTIFY_URL || '',
  };
}

async function createWechatOrder(params: {
  orderId: string;
  amount: number;
  description: string;
  notifyUrl: string;
}): Promise<Record<string, unknown>> {
  const config = await getWechatConfigFromDB();

  try {
    const crypto = await import('crypto');
    // WeChat Pay NATIVE API (QR code payment)
    const amountInFen = Math.round(params.amount * 100); // WeChat uses fen (cents)
    
    const orderParams: Record<string, string | number> = {
      appid: config.appId,
      mch_id: config.mchId,
      nonce_str: crypto.randomBytes(16).toString('hex'),
      body: params.description,
      out_trade_no: params.orderId,
      total_fee: amountInFen,
      spbill_create_ip: '127.0.0.1',
      notify_url: params.notifyUrl,
      trade_type: 'NATIVE',
      product_id: params.orderId,
    };

    // Sign
    const signString = Object.keys(orderParams)
      .sort()
      .map(k => `${k}=${orderParams[k]}`)
      .join('&') + `&key=${config.apiKey}`;

    const sign = crypto.createHash('md5').update(signString, 'utf-8').digest('hex').toUpperCase();
    orderParams.sign = sign;

    // Build XML request
    const xml = `<xml>${Object.entries(orderParams).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</xml>`;

    // Call WeChat unified order API
    const resp = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });

    const respText = await resp.text();
    // Parse XML response
    const codeUrlMatch = respText.match(/<code_url><!\[CDATA\[(.*?)\]\]><\/code_url>/);
    const returnCodeMatch = respText.match(/<return_code><!\[CDATA\[(.*?)\]\]><\/return_code>/);
    const resultCodeMatch = respText.match(/<result_code><!\[CDATA\[(.*?)\]\]><\/result_code>/);

    if (returnCodeMatch?.[1] === 'SUCCESS' && resultCodeMatch?.[1] === 'SUCCESS' && codeUrlMatch?.[1]) {
      return {
        mode: 'production',
        qrCode: codeUrlMatch[1],
        orderId: params.orderId,
      };
    }

    const errMsg = respText.match(/<err_code_des><!\[CDATA\[(.*?)\]\]><\/err_code_des>/);
    console.error('[credits] wechat order error:', errMsg?.[1] || respText);
    return {
      mode: 'demo',
      message: `微信下单失败: ${errMsg?.[1] || '未知错误'}`,
      orderId: params.orderId,
      amount: params.amount,
    };
  } catch (err) {
    console.error('[credits] wechat order error:', err);
    return {
      mode: 'demo',
      message: '微信支付创建失败，请检查配置',
      orderId: params.orderId,
      amount: params.amount,
    };
  }
}
