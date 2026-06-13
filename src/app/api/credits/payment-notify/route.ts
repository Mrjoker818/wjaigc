import { NextResponse } from 'next/server';

/**
 * 支付回调 API（保留接口，当前使用个人收款码模式不需要此回调）
 * 个人收款码模式下，管理员手动确认订单到账，不依赖支付平台异步通知。
 * 如未来对接商户API，可在此实现支付宝/微信的异步通知验签逻辑。
 */
export async function POST() {
  return NextResponse.json({ success: false, error: '当前使用个人收款码模式，不支持支付平台回调' }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ success: false, error: '当前使用个人收款码模式，不支持支付平台回调' }, { status: 400 });
}
