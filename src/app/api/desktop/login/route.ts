import { NextRequest, NextResponse } from 'next/server';
import { desktopLogin } from '@/lib/desktop-cloud';

export const dynamic = 'force-dynamic';

// 统一安全错误响应：区分业务错误与系统错误，避免泄漏内部细节
function safeError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown; appId?: unknown; deviceId?: unknown } = {};
  try {
    const text = await request.text();
    if (!text || !text.trim()) {
      return safeError('请输入账号和密码');
    }
    body = JSON.parse(text);
  } catch {
    return safeError('请求参数格式错误，请检查输入');
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return safeError('请输入账号和密码');
  }
  if (username.length > 100 || password.length > 200) {
    return safeError('账号或密码过长');
  }

  try {
    const auth = await desktopLogin({
      username,
      password,
      appId: typeof body.appId === 'string' ? body.appId.slice(0, 100) : undefined,
      deviceId: typeof body.deviceId === 'string' ? body.deviceId.slice(0, 200) : undefined,
    });
    if (!auth) return safeError('账号或密码错误', 401);
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
    // 不暴露数据库错误、连接错误等原始信息
    console.error('[desktop-login] error:', error);
    return safeError('登录失败，请稍后重试', 500);
  }
}
