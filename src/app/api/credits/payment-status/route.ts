import { NextRequest, NextResponse } from 'next/server';
import { dbGetSystemSetting } from '@/lib/db-storage';

/** GET：公开的支付状态（无需管理员权限，返回收款码可用状态和收款码图片） */
export async function GET(_request: NextRequest) {
  void _request;
  try {
    let cfg: Record<string, unknown> | null = null;
    try {
      const dbVal = await dbGetSystemSetting('payment_config');
      if (dbVal) cfg = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
    } catch { /* ignore */ }

    const wechatEnabled = (cfg?.wechatEnabled as boolean) || false;
    const wechatQrUrl = (cfg?.wechatQrUrl as string) || '';
    const wechatPayLink = (cfg?.wechatPayLink as string) || '';
    const alipayEnabled = (cfg?.alipayEnabled as boolean) || false;
    const alipayQrUrl = (cfg?.alipayQrUrl as string) || '';
    const alipayPayLink = (cfg?.alipayPayLink as string) || '';
    const note = (cfg?.note as string) || '付款时请备注您的用户名，方便管理员确认';

    // 支付方式就绪条件：已启用 + (有收款码图片 或 有支付链接)
    const wechatReady = wechatEnabled && (!!wechatQrUrl || !!wechatPayLink);
    const alipayReady = alipayEnabled && (!!alipayQrUrl || !!alipayPayLink);

    const methods: string[] = [];
    if (wechatReady) methods.push('wechat');
    if (alipayReady) methods.push('alipay');

    return NextResponse.json({
      success: true,
      status: {
        alipay: alipayReady,
        wechat: wechatReady,
      },
      // 收款码图片URL（仅管理员后台展示用，充值页面不展示）
      qrUrls: {
        wechat: wechatReady ? wechatQrUrl : '',
        alipay: alipayReady ? alipayQrUrl : '',
      },
      // 支付链接（wxp:// 或 https://qr.alipay.com/），用户点击直接跳转付款
      payLinks: {
        wechat: wechatReady ? wechatPayLink : '',
        alipay: alipayReady ? alipayPayLink : '',
      },
      note,
      canRecharge: methods.length > 0,
      methods,
    });
  } catch {
    return NextResponse.json({ success: false, canRecharge: false, methods: [], qrUrls: { wechat: '', alipay: '' }, payLinks: { wechat: '', alipay: '' }, note: '' });
  }
}
