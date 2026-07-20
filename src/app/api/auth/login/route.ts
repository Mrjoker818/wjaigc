import { NextRequest, NextResponse } from 'next/server';
import { ensureUserDataDirs } from '@/lib/server-user-storage';
import { AuthConfigurationError, authenticateUser, createSessionToken, WUJIE_SESSION_COOKIE, WUJIE_SESSION_TTL_SECONDS } from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      name?: string;
      password?: string;
      productType?: string;
      profile?: Record<string, unknown>;
    };

    // 输入校验
    const _validationError = validateApiInputs(body, {
      name: 'string',
      password: 'string',
    });
    if (_validationError) {
      return NextResponse.json({ error: _validationError }, { status: 400 });
    }

    const user = await authenticateUser({
      name: String(body.name || ''),
      password: String(body.password || ''),
      productType: body.productType,
      profile: body.profile as Partial<User> | undefined,
    });

    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
    }

    await ensureUserDataDirs(user.id);

    const response = NextResponse.json({ success: true, user });
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
