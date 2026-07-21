import { NextRequest, NextResponse } from 'next/server';
import { ensureUserDataDirs } from '@/lib/server-user-storage';
import { AuthConfigurationError, authenticateUser, createSessionToken, WUJIE_SESSION_COOKIE, WUJIE_SESSION_TTL_SECONDS } from '@/lib/server-auth';
import type { User } from '@/lib/user-types';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';

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

    const user = await authenticateUser({
      name: String(body.name || ''),
      password: String(body.password || ''),
      productType: body.productType,
      profile: body.profile as Partial<User> | undefined,
    });

    if (!user) {
      if (isFormSubmission) {
        return redirectToPublicPath(request, `/login/${body.productType === 'chat' ? 'chat' : 'canvas'}?error=invalid_credentials`);
      }
      return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
    }

    await ensureUserDataDirs(user.id);

    const response = isFormSubmission
      ? redirectToPublicPath(request, nextPath)
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
