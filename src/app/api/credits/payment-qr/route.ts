/**
 * 临时二维码生成 API
 * 生成带时效的二维码（60s），扫码后跳转到真实收款码
 * 
 * GET /api/credits/payment-qr?method=wechat|alipay
 * → 返回 PNG 二维码图片
 * 
 * 扫码后访问 /api/credits/pay-redirect?token=xxx
 * → 验证 token 有效后跳转到真实收款码页面
 */

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { dbGetSystemSetting } from '@/lib/db-storage';

type TokenData = { realQrUrl: string; method: string; expiresAt: number };

// 使用 globalThis 共享 tokenStore（跨路由共享内存）
const g = globalThis as Record<string, unknown>;
if (!g.__paymentTokenStore) {
  g.__paymentTokenStore = new Map<string, TokenData>();
  // 定时清理过期 token
  if (typeof setInterval !== 'undefined') {
    setInterval(() => {
      const store = g.__paymentTokenStore as Map<string, TokenData>;
      const now = Date.now();
      for (const [token, data] of store) {
        if (data.expiresAt < now) store.delete(token);
      }
    }, 10_000);
  }
}
const tokenStore = g.__paymentTokenStore as Map<string, TokenData>;

const TOKEN_TTL_MS = 60_000; // 60 秒有效期

/** 读取收款码配置 */
async function getPaymentConfig() {
  try {
    const raw = await dbGetSystemSetting('payment_config');
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return null; }
}

/** 生成随机 token */
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/** 获取完整的跳转 URL（扫码后访问） */
function getRedirectUrl(token: string): string {
  const domain = process.env.COZE_PROJECT_DOMAIN_DEFAULT || '';
  if (domain) {
    return `https://${domain}/api/credits/pay-redirect?token=${token}`;
  }
  return `/api/credits/pay-redirect?token=${token}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const method = searchParams.get('method'); // wechat | alipay

  if (!method || !['wechat', 'alipay'].includes(method)) {
    return NextResponse.json({ success: false, error: '无效的支付方式' }, { status: 400 });
  }

  // 读取配置
  const config = await getPaymentConfig();
  if (!config) {
    return NextResponse.json({ success: false, error: '未配置收款码' }, { status: 404 });
  }

  const enabledKey = `${method}Enabled` as 'wechatEnabled' | 'alipayEnabled';
  const qrKey = `${method}QrUrl` as 'wechatQrUrl' | 'alipayQrUrl';

  if (!config[enabledKey] || !config[qrKey]) {
    return NextResponse.json({ success: false, error: `${method === 'wechat' ? '微信' : '支付宝'}收款码未配置` }, { status: 404 });
  }

  const realQrUrl: string = config[qrKey];

  // 生成临时 token
  const token = generateToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  tokenStore.set(token, { realQrUrl, method, expiresAt });

  // 构建扫码后跳转 URL
  const redirectUrl = getRedirectUrl(token);

  try {
    // 生成二维码 PNG
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
