/**
 * 临时二维码生成 API
 * 生成带时效的二维码（60s），扫码后跳转到真实收款码
 * 
 * GET /api/credits/payment-qr?method=wechat|alipay
 * → 返回 PNG 二维码图片
 * 
 * 扫码后访问 /api/credits/pay-redirect?token=xxx
 * → 验证 token 有效后跳转到真实收款码页面
 * 
 * v2: 使用 HMAC 签名令牌替代内存 Map，服务器重启不丢失令牌
 */

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getProductionPaymentConfigurationIssues, loadPaymentConfig } from '@/lib/payment-config';

const TOKEN_TTL_MS = 60_000; // 60 秒有效期
const DEVELOPMENT_PAYMENT_TOKEN_SECRET = crypto.randomBytes(48).toString('base64url');

export class PaymentTokenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentTokenConfigurationError';
  }
}

/** HMAC 密钥：生产环境必须显式配置；开发环境仅使用进程内随机密钥。 */
export function getPaymentTokenSecret(): string {
  const configured = process.env.PAYMENT_TOKEN_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;

  if (getProductionPaymentConfigurationIssues().length > 0) {
    throw new PaymentTokenConfigurationError('Production payment token secret is not configured. Set PAYMENT_TOKEN_SECRET to at least 32 random characters.');
  }

  return DEVELOPMENT_PAYMENT_TOKEN_SECRET;
}

/** 生成 HMAC 签名令牌 */
function signToken(data: { realQrUrl: string; method: string; expiresAt: number }): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getPaymentTokenSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/** 验证并解析 HMAC 签名令牌 */
export function verifyToken(token: string): { realQrUrl: string; method: string; expiresAt: number } | null {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const payload = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);

    const expectedSig = crypto
      .createHmac('sha256', getPaymentTokenSecret())
      .update(payload)
      .digest('base64url');

    // 常量时间比较防止时序攻击
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!data.realQrUrl || !data.method || !data.expiresAt) return null;
    return data;
  } catch {
    return null;
  }
}

/** 获取完整的跳转 URL（扫码后访问） */
function getRedirectUrl(token: string): string {
  let domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
  domain = domain.replace(/^https?:\/\//, '');
  if (domain) {
    return `https://${domain}/api/credits/pay-redirect?token=${encodeURIComponent(token)}`;
  }
  return `/api/credits/pay-redirect?token=${encodeURIComponent(token)}`;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    getPaymentTokenSecret();
  } catch (error) {
    if (error instanceof PaymentTokenConfigurationError) {
      return NextResponse.json({ success: false, error: '支付服务签名密钥未配置' }, { status: 503 });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const method = searchParams.get('method'); // wechat | alipay

  if (!method || !['wechat', 'alipay'].includes(method)) {
    return NextResponse.json({ success: false, error: '无效的支付方式' }, { status: 400 });
  }

  const config = await loadPaymentConfig();

  const enabledKey = `${method}Enabled` as 'wechatEnabled' | 'alipayEnabled';
  const qrKey = `${method}QrUrl` as 'wechatQrUrl' | 'alipayQrUrl';

  if (!config[enabledKey] || !config[qrKey]) {
    return NextResponse.json({ success: false, error: `${method === 'wechat' ? '微信' : '支付宝'}收款码未配置` }, { status: 404 });
  }

  const realQrUrl: string = config[qrKey];
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  // 使用 HMAC 签名令牌（无需内存存储，服务器重启不丢失）
  const token = signToken({ realQrUrl, method, expiresAt });

  const redirectUrl = getRedirectUrl(token);

  try {
    const qrPng = await QRCode.toBuffer(redirectUrl, {
      type: 'png',
      width: 280,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    });

    return new NextResponse(new Uint8Array(qrPng), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-QR-Expires-In': '60',
        'X-QR-Token': token,
      },
    });
  } catch (err) {
    console.error('[payment-qr] 生成二维码失败:', err);
    return NextResponse.json({ success: false, error: '生成二维码失败' }, { status: 500 });
  }
}
