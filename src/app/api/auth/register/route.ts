import { NextRequest, NextResponse } from 'next/server';
import { createManagedUser } from '@/lib/server-auth';
import { getRuntimeSettings } from '@/lib/runtime-settings';
import { createSessionToken, WUJIE_SESSION_COOKIE, WUJIE_SESSION_TTL_SECONDS } from '@/lib/server-auth';
import { validateApiInputs } from '@/lib/api-validator';
import { dbAddAuditLog } from '@/lib/db-storage';

export const dynamic = 'force-dynamic';

// 限流存储（内存，与 login 路由共享策略）
const registerRateLimitMap = new Map<string, { failures: number; lockedUntil: number }>();
const REGISTER_RATE_LIMIT_MAX_FAILURES = 5;
const REGISTER_RATE_LIMIT_LOCK_DURATION_MS = 60_000; // 1分钟

// 保留用户名黑名单
const RESERVED_USERNAMES = new Set([
  'admin', 'root', 'system', 'administrator', 'superuser', 'sysadmin',
  'moderator', 'webmaster', 'postmaster', 'hostmaster', 'support',
  'security', 'abuse', 'noreply', 'no-reply', 'robot', 'bot',
]);

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function checkRegisterRateLimit(ip: string): { blocked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${ip}::register`;
  const entry = registerRateLimitMap.get(key);

  if (!entry) return { blocked: false, retryAfterSeconds: 0 };

  if (entry.lockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }

  // 锁定过期，清除记录
  registerRateLimitMap.delete(key);
  return { blocked: false, retryAfterSeconds: 0 };
}

function recordRegisterFailure(ip: string): void {
  const now = Date.now();
  const key = `${ip}::register`;
  const entry = registerRateLimitMap.get(key) || { failures: 0, lockedUntil: 0 };

  entry.failures += 1;
  if (entry.failures >= REGISTER_RATE_LIMIT_MAX_FAILURES) {
    entry.lockedUntil = now + REGISTER_RATE_LIMIT_LOCK_DURATION_MS;
  }

  registerRateLimitMap.set(key, entry);

  // 定期清理过期记录（简单策略：每次记录失败时清理一次）
  if (registerRateLimitMap.size > 500) {
    for (const [k, v] of registerRateLimitMap.entries()) {
      if (v.lockedUntil && v.lockedUntil < now - 300_000) {
        registerRateLimitMap.delete(k);
      }
    }
  }
}

function clearRegisterRateLimit(ip: string): void {
  const key = `${ip}::register`;
  registerRateLimitMap.delete(key);
}

function validateUsername(username: string): { valid: boolean; error?: string } {
  // 3-32位，仅允许字母、数字、下划线
  if (username.length < 3 || username.length > 32) {
    return { valid: false, error: '用户名长度必须在 3-32 位之间' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, error: '用户名只能包含字母、数字和下划线' };
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return { valid: false, error: '该用户名为系统保留，请更换' };
  }
  return { valid: true };
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: '密码长度至少 6 位' };
  }
  if (password.length > 128) {
    return { valid: false, error: '密码长度不能超过 128 位' };
  }
  return { valid: true };
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email) return { valid: true }; // 邮箱可选
  if (email.length > 320) {
    return { valid: false, error: '邮箱长度不能超过 320 位' };
  }
  // 简单邮箱格式校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: '邮箱格式不正确' };
  }
  return { valid: true };
}

// GET: 检查注册功能是否开放（无需鉴权）
export async function GET() {
  try {
    const runtimeSettings = await getRuntimeSettings();
    return NextResponse.json({ registrationEnabled: runtimeSettings.registrationEnabled ?? false });
  } catch {
    return NextResponse.json({ registrationEnabled: false });
  }
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  try {
    // 1. 检查注册功能是否开放
    const runtimeSettings = await getRuntimeSettings();
    if (!runtimeSettings.registrationEnabled) {
      return NextResponse.json(
        { success: false, error: '注册功能未开放，请联系管理员' },
        { status: 403 }
      );
    }

    // 2. 限流检查
    const rateCheck = checkRegisterRateLimit(clientIp);
    if (rateCheck.blocked) {
      return NextResponse.json(
        { success: false, error: `注册失败次数过多，请 ${rateCheck.retryAfterSeconds} 秒后重试` },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds),
            'X-RateLimit-Limit': String(REGISTER_RATE_LIMIT_MAX_FAILURES),
          },
        }
      );
    }

    // 3. 解析请求体
    const body = await request.json() as {
      name?: string;
      password?: string;
      confirmPassword?: string;
      email?: string;
      productType?: string;
    };

    // 4. 输入校验
    const validationError = validateApiInputs(body, {
      name: 'string',
      password: 'string',
    });
    if (validationError) {
      recordRegisterFailure(clientIp);
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }

    const username = String(body.name || '').trim();
    const password = String(body.password || '').trim();
    const confirmPassword = String(body.confirmPassword || '').trim();
    const email = String(body.email || '').trim();
    const productType = body.productType || 'canvas,chat';

    // 5. 用户名格式校验
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      recordRegisterFailure(clientIp);
      return NextResponse.json({ success: false, error: usernameValidation.error }, { status: 400 });
    }

    // 6. 密码强度校验
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      recordRegisterFailure(clientIp);
      return NextResponse.json({ success: false, error: passwordValidation.error }, { status: 400 });
    }

    // 7. 密码确认校验
    if (password !== confirmPassword) {
      recordRegisterFailure(clientIp);
      return NextResponse.json({ success: false, error: '两次输入的密码不一致' }, { status: 400 });
    }

    // 8. 邮箱格式校验（可选）
    if (email) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        recordRegisterFailure(clientIp);
        return NextResponse.json({ success: false, error: emailValidation.error }, { status: 400 });
      }
    }

    // 9. 创建用户
    try {
      const user = await createManagedUser({
        name: username,
        password,
        email: email || undefined,
        productType,
      });

      // 注册成功，清除限流记录
      clearRegisterRateLimit(clientIp);

      // 10. 自动登录（设置 session cookie）
      const sessionToken = await createSessionToken(user);
      const isHttps = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
      
      const response = NextResponse.json({ success: true, user });
      response.cookies.set(WUJIE_SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        path: '/',
        maxAge: WUJIE_SESSION_TTL_SECONDS,
      });

      // 11. 审计日志
      try {
        await dbAddAuditLog({
          user_id: user.id,
          user_name: user.name,
          action: 'user_register',
          target_type: 'user',
          target_id: user.id,
          detail: `用户 ${user.name} 注册成功`,
          ip_address: clientIp,
          created_at: Date.now(),
        });
      } catch {
        // 审计日志失败不影响注册
      }

      return response;
    } catch (error) {
      // 用户名已存在 or 其他创建失败
      recordRegisterFailure(clientIp);
      const errorMessage = error instanceof Error ? error.message : '注册失败';
      
      // 用户名已存在时不暴露具体原因（安全考虑）
      if (errorMessage.includes('already exists')) {
        return NextResponse.json({ success: false, error: '该用户名已被注册' }, { status: 409 });
      }
      
      return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
    }
  } catch (error) {
    console.error('[auth/register] POST error:', error);
    recordRegisterFailure(clientIp);
    return NextResponse.json(
      { success: false, error: '注册失败，请稍后重试' },
      { status: 500 }
    );
  }
}
