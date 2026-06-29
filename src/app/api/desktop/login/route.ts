import { NextRequest, NextResponse } from 'next/server';
import { desktopConfigFor, desktopLogin } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body.username || body.name || '').trim();
    const password = String(body.password || '');
    const auth = await desktopLogin({
      username,
      password,
      appId: request.headers.get('x-wujie-app-id') || '',
      deviceId: request.headers.get('x-wujie-device-id') || '',
    });
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
    }
    const config = await desktopConfigFor(auth.user);
    return NextResponse.json({ ...config, token: auth.token });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Desktop login failed' }, { status: 500 });
  }
}
