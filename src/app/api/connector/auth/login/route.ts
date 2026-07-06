import { NextRequest, NextResponse } from 'next/server';
import { desktopLogin } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      username?: unknown;
      password?: unknown;
      appId?: unknown;
      deviceId?: unknown;
    };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      return NextResponse.json({ success: false, error: '请输入账号和密码' }, { status: 400 });
    }
    const auth = await desktopLogin({
      username,
      password,
      appId: typeof body.appId === 'string' ? body.appId.slice(0, 100) : undefined,
      deviceId: typeof body.deviceId === 'string' ? body.deviceId.slice(0, 200) : undefined,
    });
    if (!auth) {
      return NextResponse.json({ success: false, error: '账号或密码错误' }, { status: 401 });
    }
    return NextResponse.json({
      success: true,
      token: auth.token,
      user: {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      },
    });
  } catch (error) {
    console.error('[connector-login] error:', error);
    return NextResponse.json({ success: false, error: '登录失败，请稍后重试' }, { status: 500 });
  }
}