import { NextRequest, NextResponse } from 'next/server';
import { ensureUserDataDirs } from '@/lib/server-user-storage';
import { AuthConfigurationError, authenticateUser, createSessionToken, WUJIE_SESSION_COOKIE, WUJIE_SESSION_TTL_SECONDS } from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';

// ─── In-memory rate limiter (P1-1) ──────────────────────────────────────────
// Tracks failed login attempts per key (ip::username). Auto-evicts stale entries.
interface RateLimitEntry {
  failures: number;
  lockedUntil: number; // epoch ms; 0 = not locked
  windowStart: number; // epoch ms of current window
}

const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;   // 1 minute
const RATE_LIMIT_LOCK_MS   = 60 * 1000;   // lock for 1 minute after max failures
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const rateLimitMap = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent unbounded memory growth
function cleanupRateLimitMap() {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.lockedUntil && now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
}
setInterval(cleanupRateLimitMap, RATE_LIMIT_CLEANUP_INTERVAL_MS).unref?.();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimit(ip: string, username: string): { blocked: boolean; retryAfterSeconds: number } {
  const key = `${ip}::${username.toLowerCase()}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry) return { blocked: false, retryAfterSeconds: 0 };

  // Still in lock period
  if (entry.lockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }

  // Window has expired — reset
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.delete(key);
    return { blocked: false, retryAfterSeconds: 0 };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

function recordFailedAttempt(ip: string, username: string): void {
  const key = `${ip}::${username.toLowerCase()}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { failures: 1, lockedUntil: 0, windowStart: now });
    return;
  }

  entry.failures += 1;
  if (entry.failures >= RATE_LIMIT_MAX_FAILURES) {
    entry.lockedUntil = now + RATE_LIMIT_LOCK_MS;
  }
}

function clearRateLimitOnSuccess(ip: string, username: string): void {
  const key = `${ip}::${username.toLowerCase()}`;
  rateLimitMap.delete(key);
}

function getPublicOrigin(request: NextRequest): string {
  const configuredDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim();
  if (configuredDomain) {
    const withProtocol = /^https?:\/\//i.test(configuredDomain)
      ? configuredDomain
      : `https://${configuredDomain}`;

    try {
      return new URL(withProtocol).origin;
    } catch {
      // Fall through to the request origin when the deployment setting is malformed.
    }
  }

  return request.nextUrl.origin;
}

function redirectToPublicPath(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getPublicOrigin(request)), 303);
}

export async function POST(request: NextRequest) {
  const isFormSubmission = request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')
    || request.headers.get('content-type')?.includes('multipart/form-data');
  let formProductType: 'canvas' | 'chat' = 'canvas';

  try {
    const body = (isFormSubmission
      ? Object.fromEntries(await request.formData())
      : await request.json()) as {
      name?: string;
      password?: string;
      productType?: string;
      next?: string;
      profile?: Record<string, unknown>;
    };
    formProductType = body.productType === 'chat' ? 'chat' : 'canvas';
    const nextPath = body.next === '/simple-chat' ? '/simple-chat' : '/';

    // 输入校验
    const _validationError = validateApiInputs(body, {
      name: 'string',
      password: 'string',
    });
    if (_validationError) {
      if (isFormSubmission) {
        return redirectToPublicPath(request, `/login/${body.productType === 'chat' ? 'chat' : 'canvas'}?error=invalid_input`);
      }
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    // ── 限流检查 (P1-1) ─────────────────────────────────────────
    const clientIp = getClientIp(request);
    const username = String(body.name || '');
    const rateCheck = checkRateLimit(clientIp, username);
    if (rateCheck.blocked) {
      if (isFormSubmission) {
        return redirectToPublicPath(request, `/login/${formProductType}?error=too_many_attempts`);
      }
      return NextResponse.json(
        { success: false, error: `Too many failed attempts. Please try again in ${rateCheck.retryAfterSeconds} seconds.` },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds),
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX_FAILURES),
          },
        }
      );
    }

    const user = await authenticateUser({
      name: username,
      password: String(body.password || ''),
      productType: body.productType,
      profile: body.profile as Partial<User> | undefined,
    });

    if (!user) {
      // 记录失败次数
      recordFailedAttempt(clientIp, username);
      if (isFormSubmission) {
        return redirectToPublicPath(request, `/login/${body.productType === 'chat' ? 'chat' : 'canvas'}?error=invalid_credentials`);
      }
      return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
    }

    // 登录成功，清除限流记录
    clearRateLimitOnSuccess(clientIp, username);

    await ensureUserDataDirs(user.id);

    const successPath = formProductType === 'chat'
      ? '/simple-chat'
      : `${nextPath}?loginMode=canvas`;
    const response = isFormSubmission
      ? redirectToPublicPath(request, successPath)
      : NextResponse.json({ success: true, user });
    // Only set secure flag when the connection itself is HTTPS.
    // On HTTP (e.g. http://127.0.0.1:5000 in test/dev), WebKit rejects secure cookies.
    const isHttps = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
    response.cookies.set(WUJIE_SESSION_COOKIE, await createSessionToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: WUJIE_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    if (isFormSubmission) {
      const errorCode = error instanceof AuthConfigurationError ? 'configuration' : 'login_failed';
      return redirectToPublicPath(request, `/login/${formProductType}?error=${errorCode}`);
    }
    if (error instanceof AuthConfigurationError) {
      return NextResponse.json({
        success: false,
        error: error.message,
      }, { status: 503 });
    }
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    }, { status: 500 });
  }
}
