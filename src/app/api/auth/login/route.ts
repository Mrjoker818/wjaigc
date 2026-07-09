import { NextRequest, NextResponse } from 'next/server';
import { ensureUserDataDirs } from '@/lib/server-user-storage';
import { authenticateUser, createSessionToken, WUJIE_SESSION_COOKIE, WUJIE_SESSION_TTL_SECONDS } from '@/lib/server-auth';
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
    response.cookies.set(WUJIE_SESSION_COOKIE, await createSessionToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: WUJIE_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Login failed',
    }, { status: 500 });
  }
}
