import { NextRequest, NextResponse } from 'next/server';
import { getDesktopAuth, tokenFromHeader, upsertDesktopDevice } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await getDesktopAuth(tokenFromHeader(request.headers.get('authorization')));
    if (!auth) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    await upsertDesktopDevice({
      userId: auth.user.id,
      appId: request.headers.get('x-wujie-app-id') || String(body.appId || ''),
      deviceId: request.headers.get('x-wujie-device-id') || String(body.deviceId || ''),
      deviceName: String(body.deviceName || ''),
      platform: String(body.platform || ''),
      arch: String(body.arch || ''),
      version: String(body.version || ''),
      status: 'online',
    });
    return NextResponse.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Heartbeat failed' }, { status: 500 });
  }
}
