import { NextRequest, NextResponse } from 'next/server';
import { execSql } from '@/lib/db-client';
import { dbAdjustCredits } from '@/lib/db-storage';
import crypto from 'crypto';

/**
 * POST /api/credits/payment-notify
 * Payment callback endpoint for Alipay and WeChat Pay.
 * This is called by the payment platform when payment succeeds.
 * 
 * Security: Verifies signature to ensure the callback is authentic.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let paymentMethod: 'alipay' | 'wechat' = 'alipay';

    if (contentType.includes('xml')) {
      paymentMethod = 'wechat';
    } else if (contentType.includes('json') || contentType.includes('form')) {
      paymentMethod = 'alipay';
    } else {
      // Try to detect from URL params
      const url = new URL(request.url);
      paymentMethod = (url.searchParams.get('payment_method') as 'alipay' | 'wechat') || 'alipay';
    }

    if (paymentMethod === 'alipay') {
      return await handleAlipayNotify(request);
    } else {
      return await handleWechatNotify(request);
    }
  } catch (e) {
    console.error('[payment-notify] error:', e);
    return new NextResponse('fail', { status: 500 });
  }
}

/**
 * GET /api/credits/payment-notify
 * Alipay uses GET for return_url (user browser redirect).
 * We just redirect the user back to the app.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const outTradeNo = url.searchParams.get('out_trade_no');
  const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || 'http://localhost:5000';
  const redirectUrl = domain.startsWith('http') ? domain : `https://${domain}`;
  return NextResponse.redirect(`${redirectUrl}/?order_id=${outTradeNo || ''}&payment=alipay`);
}

// ========== Alipay Notification Handler ==========

async function handleAlipayNotify(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Verify Alipay signature
  const sign = params['sign'];
  const signType = params['sign_type'] || 'RSA2';

  if (!verifyAlipaySignature(params, sign, signType)) {
    console.error('[payment-notify] alipay signature verification failed');
    return new NextResponse('sign check fail', { status: 400 });
  }

  // Check trade status
  const tradeStatus = params['trade_status'];
  if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
    // Not a successful payment, just acknowledge
    return new NextResponse('success');
  }

  const outTradeNo = params['out_trade_no']; // Our order ID
  const tradeNo = params['trade_no']; // Alipay transaction ID

  // Process the payment
  const result = await processSuccessfulPayment(outTradeNo, tradeNo, 'alipay');

  if (result) {
    return new NextResponse('success');
  } else {
    return new NextResponse('fail', { status: 500 });
  }
}

function verifyAlipaySignature(
  params: Record<string, string>,
  sign: string | undefined,
  signType: string
): boolean {
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;
  if (!alipayPublicKey || !sign) {
    // If no public key configured, skip verification in dev mode
    if (process.env.COZE_PROJECT_ENV !== 'PROD') {
      console.warn('[payment-notify] alipay: skipping signature verification in dev mode');
      return true;
    }
    return false;
  }

  // Build sign string: sort all params except sign/sign_type, join with &
  const signString = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');

  try {
    const verify = crypto.createVerify(signType === 'RSA2' ? 'RSA-SHA256' : 'RSA-SHA1');
    verify.update(signString, 'utf-8');
    const pemKey = alipayPublicKey.includes('-----') ? alipayPublicKey : `-----BEGIN PUBLIC KEY-----\n${alipayPublicKey}\n-----END PUBLIC KEY-----`;
    return verify.verify(pemKey, sign, 'base64');
  } catch (err) {
    console.error('[payment-notify] alipay verify error:', err);
    return false;
  }
}

// ========== WeChat Pay Notification Handler ==========

async function handleWechatNotify(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();

  // Parse XML
  const resultCode = body.match(/<result_code><!\[CDATA\[(.*?)\]\]><\/result_code>/)?.[1];
  const returnCode = body.match(/<return_code><!\[CDATA\[(.*?)\]\]><\/return_code>/)?.[1];

  if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
    // Payment failed
    const failXml = `<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>`;
    return new NextResponse(failXml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  // Verify WeChat signature
  if (!verifyWechatSignature(body)) {
    console.error('[payment-notify] wechat signature verification failed');
    const failXml = `<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[Signature verification failed]]></return_msg></xml>`;
    return new NextResponse(failXml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  const outTradeNo = body.match(/<out_trade_no><!\[CDATA\[(.*?)\]\]><\/out_trade_no>/)?.[1];
  const tradeNo = body.match(/<transaction_id><!\[CDATA\[(.*?)\]\]><\/transaction_id>/)?.[1];

  if (!outTradeNo) {
    const failXml = `<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[Missing out_trade_no]]></return_msg></xml>`;
    return new NextResponse(failXml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  const result = await processSuccessfulPayment(outTradeNo, tradeNo || '', 'wechat');

  const replyXml = result
    ? `<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>`
    : `<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[Process failed]]></return_msg></xml>`;

  return new NextResponse(replyXml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}

function verifyWechatSignature(xmlBody: string): boolean {
  const apiKey = process.env.WECHAT_API_KEY;
  if (!apiKey) {
    if (process.env.COZE_PROJECT_ENV !== 'PROD') {
      console.warn('[payment-notify] wechat: skipping signature verification in dev mode');
      return true;
    }
    return false;
  }

  // Extract all XML fields
  const fields: Record<string, string> = {};
  const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
  let match;
  while ((match = regex.exec(xmlBody)) !== null) {
    if (match[1] !== 'sign') {
      fields[match[1]] = match[2];
    }
  }
  // Also try without CDATA
  const regex2 = /<(\w+)>([^<]*)<\/\1>/g;
  while ((match = regex2.exec(xmlBody)) !== null) {
    if (match[1] !== 'sign' && !fields[match[1]]) {
      fields[match[1]] = match[2];
    }
  }

  const receivedSign = xmlBody.match(/<sign><!\[CDATA\[(.*?)\]\]><\/sign>/)?.[1] ||
                       xmlBody.match(/<sign>([^<]*)<\/sign>/)?.[1] || '';

  // Build sign string
  const signString = Object.keys(fields)
    .filter(k => fields[k] !== '')
    .sort()
    .map(k => `${k}=${fields[k]}`)
    .join('&') + `&key=${apiKey}`;

  const expectedSign = crypto.createHash('md5').update(signString, 'utf-8').digest('hex').toUpperCase();

  return receivedSign === expectedSign;
}

// ========== Common Payment Processing ==========

async function processSuccessfulPayment(
  orderId: string,
  tradeNo: string,
  paymentMethod: string
): Promise<boolean> {
  try {
    // Find the order
    const orderResult = await execSql(
      'SELECT * FROM wujie_recharge_orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      console.error('[payment-notify] order not found:', orderId);
      return false;
    }

    const order = orderResult.rows[0] as Record<string, unknown>;

    // Check if already processed (idempotent)
    if (order.payment_status === 'paid') {
      console.log('[payment-notify] order already processed:', orderId);
      return true;
    }

    // Check if expired
    if (order.payment_status === 'expired' || (order.expires_at && Number(order.expires_at) < Date.now())) {
      console.error('[payment-notify] order expired:', orderId);
      await execSql(
        "UPDATE wujie_recharge_orders SET payment_status = 'expired', updated_at = $1 WHERE id = $2",
        [Date.now(), orderId]
      );
      return false;
    }

    // Update order status
    const now = Date.now();
    await execSql(
      `UPDATE wujie_recharge_orders 
       SET payment_status = 'paid', trade_no = $1, paid_at = $2, updated_at = $3 
       WHERE id = $4`,
      [tradeNo, now, now, orderId]
    );

    // Add credits to user account
    const userId = order.user_id as string;
    const amount = Number(order.amount);
    const bonusAmount = Number(order.bonus || 0);
    const totalCredits = amount; // amount already includes bonus

    const desc = `充值 ${totalCredits} 积分 (${paymentMethod === 'alipay' ? '支付宝' : '微信支付'}${bonusAmount > 0 ? `，含赠送 ${bonusAmount} 积分` : ''})`;
    const result = await dbAdjustCredits(userId, totalCredits, 'recharge', desc, orderId);

    if (!result.success) {
      console.error('[payment-notify] failed to add credits:', result.message);
      // Mark order as failed
      await execSql(
        "UPDATE wujie_recharge_orders SET payment_status = 'failed', updated_at = $1 WHERE id = $2",
        [Date.now(), orderId]
      );
      return false;
    }

    console.log(`[payment-notify] success: order=${orderId}, user=${userId}, credits=+${totalCredits}, tradeNo=${tradeNo}`);
    return true;
  } catch (e) {
    console.error('[payment-notify] process error:', e);
    return false;
  }
}
