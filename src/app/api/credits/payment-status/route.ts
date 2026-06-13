import { NextRequest, NextResponse } from 'next/server';
import { dbGetSystemSetting } from '@/lib/db-storage';

/** GET：公开的支付状态（无需管理员权限，仅返回是否可用） */
export async function GET(_request: NextRequest) {
  try {
    let cfg: Record<string, unknown> | null = null;
    try {
      const dbVal = await dbGetSystemSetting('payment_config');
      if (dbVal) cfg = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
    } catch { /* ignore */ }

    // 合并环境变量
    const alipayEnabled = (cfg?.alipay as Record<string, unknown>)?.enabled as boolean
      || !!process.env.ALIPAY_APP_ID;
    const alipayHasKeys = !!(
      ((cfg?.alipay as Record<string, unknown>)?.privateKey as string) || process.env.ALIPAY_PRIVATE_KEY
    ) && !!(
      ((cfg?.alipay as Record<string, unknown>)?.publicKey as string) || process.env.ALIPAY_PUBLIC_KEY
    );
    const alipayReady = alipayEnabled && alipayHasKeys;

    const wechatEnabled = (cfg?.wechat as Record<string, unknown>)?.enabled as boolean
      || !!process.env.WECHAT_MCH_ID;
    const wechatHasKeys = !!(
      ((cfg?.wechat as Record<string, unknown>)?.apiKey as string) || process.env.WECHAT_API_KEY
    );
    const wechatReady = wechatEnabled && wechatHasKeys;

    const methods: string[] = [];
    if (alipayReady) methods.push('alipay');
    if (wechatReady) methods.push('wechat');

    return NextResponse.json({
      success: true,
      status: {
        alipay: alipayReady,
        wechat: wechatReady,
      },
      canRecharge: methods.length > 0,
      methods,
    });
  } catch {
    return NextResponse.json({ success: false, canRecharge: false, methods: [] });
  }
}
