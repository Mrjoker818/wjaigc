import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuthOrReject } from '@/lib/api-auth';
import { getPaymentStatus } from '@/lib/payment-config';

/** GET：已登录用户的支付状态（包含收款码和直付链接） */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuthOrReject(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    return NextResponse.json({ success: true, ...(await getPaymentStatus()) });
  } catch {
    return NextResponse.json({
      success: false,
      canRecharge: false,
      methods: [],
      qrUrls: { wechat: '', alipay: '' },
      payLinks: { wechat: '', alipay: '' },
      note: '',
    });
  }
}
