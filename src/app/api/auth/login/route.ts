import { NextRequest, NextResponse } from 'next/server';
import {
  AuthConfigurationError,
  authenticateUser,
  createSessionToken,
  WUJIE_SESSION_COOKIE,
  WUJIE_SESSION_TTL_SECONDS,
} from '@/lib/server-auth';
import { AuthServiceError } from '@/lib/auth/auth-errors';
import type { User } from '@/lib/user-types';
import { validateApiInputs } from '@/lib/api-validator';

export const dynamic = 'force-dynamic';

interface RateLimitEntry {
  failures: number;
  lockedUntil: number;
  windowStart: number;
}

const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_LOCK_MS = 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

type RouteAuthServiceCode =
  | 'AUTH_CONFIGURATION_UNAVAILABLE'
  | 'AUTH_PERSISTENCE_UNAVAILABLE'
  | 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS'
  | 'AUTH_CREDENTIAL_FORMAT_INVALID';
type AuthPersistenceMode = 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';
type FormError = 'invalid_credentials' | 'too_many_attempts' | 'configuration' | 'temporarily_unavailable';

interface RouteAuthErrorContract {
  status: 409 | 503;
  retryable: boolean;
  message: string;
}

const AUTH_ROUTE_ERROR_CONTRACTS = Object.assign(
  Object.create(null) as Record<RouteAuthServiceCode, RouteAuthErrorContract>,
  {
    AUTH_CONFIGURATION_UNAVAILABLE: {
      status: 503,
      retryable: true,
      message: 'Authentication configuration is unavailable.',
    },
    AUTH_PERSISTENCE_UNAVAILABLE: {
      status: 503,
      retryable: true,
      message: 'Authentication persistence is unavailable.',
    },
    AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS: {
      status: 409,
      retryable: false,
      message: 'Authentication credential rotation is unavailable.',
    },
    AUTH_CREDENTIAL_FORMAT_INVALID: {
      status: 503,
      retryable: false,
      message: 'Authentication credential format is invalid.',
    },
  } satisfies Record<RouteAuthServiceCode, RouteAuthErrorContract>,
);

interface AuthResultLog {
  requestId: string;
  userId?: string;
  errorCode?: string;
  persistenceMode?: AuthPersistenceMode;
  kid?: string;
  durationMs: number;
  result: 'success' | 'failure';
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function cleanupRateLimitMap(): void {
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
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  );
}

function checkRateLimit(ip: string, username: string): { blocked: boolean; retryAfterSeconds: number } {
  const key = `${ip}::${username.toLowerCase()}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry) return { blocked: false, retryAfterSeconds: 0 };
  if (entry.lockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
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
  if (entry.failures >= RATE_LIMIT_MAX_FAILURES) entry.lockedUntil = now + RATE_LIMIT_LOCK_MS;
}

function clearRateLimitOnSuccess(ip: string, username: string): void {
  rateLimitMap.delete(`${ip}::${username.toLowerCase()}`);
}

function getRequestId(request: NextRequest): string {
  const candidate = request.headers.get('x-request-id');
  return candidate
    && candidate.length <= 128
    && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

function getPersistenceModeForLog(): AuthPersistenceMode | undefined {
  const configuredMode = process.env.WUJIE_AUTH_PERSISTENCE_MODE;
  if (
    configuredMode === 'DB_ONLY'
    || configuredMode === 'DB_PLUS_FILE'
    || configuredMode === 'FILE_ONLY'
  ) {
    return configuredMode;
  }
  if (configuredMode !== undefined) return undefined;
  return process.env.DATABASE_URL || process.env.PGDATABASE_URL ? 'DB_ONLY' : 'FILE_ONLY';
}

function getRouteAuthError(
  error: unknown,
): (RouteAuthErrorContract & { code: RouteAuthServiceCode }) | null {
  if (!(error instanceof AuthServiceError)) return null;
  const code = error.code as string;
  if (!Object.hasOwn(AUTH_ROUTE_ERROR_CONTRACTS, code)) return null;
  return {
    code: code as RouteAuthServiceCode,
    ...AUTH_ROUTE_ERROR_CONTRACTS[code as RouteAuthServiceCode],
  };
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

function logResult(log: AuthResultLog): void {
  const entry: AuthResultLog = { ...log };
  const persistenceMode = getPersistenceModeForLog();
  if (persistenceMode) entry.persistenceMode = persistenceMode;
  try {
    console.info(entry);
  } catch {
    // Authentication responses must not depend on the runtime logger.
  }
}

function finishResponse(
  response: NextResponse,
  input: Omit<AuthResultLog, 'durationMs' | 'persistenceMode' | 'kid'> & { startedAt: number },
): NextResponse {
  response.headers.set('x-request-id', input.requestId);
  logResult({
    requestId: input.requestId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    durationMs: Math.max(0, Date.now() - input.startedAt),
    result: input.result,
  });
  return response;
}

function jsonError(
  status: number,
  code: string,
  error: string,
  retryable: boolean,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(
    { success: false, code, error, retryable },
    { status, headers },
  );
}

function formErrorForServiceCode(code: RouteAuthServiceCode): FormError {
  return code === 'AUTH_CONFIGURATION_UNAVAILABLE' || code === 'AUTH_CREDENTIAL_FORMAT_INVALID'
    ? 'configuration'
    : 'temporarily_unavailable';
}

function isValidLoginInput(body: Record<string, unknown>): boolean {
  if (validateApiInputs(body, { name: 'string', password: 'string' })) return false;
  return typeof body.name === 'string'
    && body.name.trim().length > 0
    && typeof body.password === 'string'
    && body.password.length > 0;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const contentType = request.headers.get('content-type') || '';
  const isFormSubmission = contentType.includes('application/x-www-form-urlencoded')
    || contentType.includes('multipart/form-data');
  let formProductType: 'canvas' | 'chat' = 'canvas';

  try {
    let rawBody: unknown;
    try {
      rawBody = isFormSubmission
        ? Object.fromEntries(await request.formData())
        : await request.json();
    } catch {
      rawBody = null;
    }
    const body = rawBody && typeof rawBody === 'object'
      ? rawBody as Record<string, unknown>
      : {};
    formProductType = body.productType === 'chat' ? 'chat' : 'canvas';

    if (!isValidLoginInput(body)) {
      const response = isFormSubmission
        ? redirectToPublicPath(request, `/login/${formProductType}?error=invalid_credentials`)
        : jsonError(400, 'AUTH_INVALID_INPUT', 'Invalid login input.', false);
      return finishResponse(response, {
        requestId,
        errorCode: 'AUTH_INVALID_INPUT',
        result: 'failure',
        startedAt,
      });
    }

    const username = body.name as string;
    const clientIp = getClientIp(request);
    const rateCheck = checkRateLimit(clientIp, username);
    if (rateCheck.blocked) {
      const rateLimitHeaders = {
        'Retry-After': String(rateCheck.retryAfterSeconds),
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX_FAILURES),
      };
      const response = isFormSubmission
        ? redirectToPublicPath(request, `/login/${formProductType}?error=too_many_attempts`)
        : jsonError(
          429,
          'AUTH_TOO_MANY_ATTEMPTS',
          'Too many login attempts. Please try again later.',
          true,
          rateLimitHeaders,
        );
      if (isFormSubmission) {
        for (const [name, value] of Object.entries(rateLimitHeaders)) response.headers.set(name, value);
      }
      return finishResponse(response, {
        requestId,
        errorCode: 'AUTH_TOO_MANY_ATTEMPTS',
        result: 'failure',
        startedAt,
      });
    }

    const user = await authenticateUser({
      name: username,
      password: body.password as string,
      productType: typeof body.productType === 'string' ? body.productType : undefined,
      profile: body.profile as Partial<User> | undefined,
    });

    if (!user) {
      recordFailedAttempt(clientIp, username);
      const response = isFormSubmission
        ? redirectToPublicPath(request, `/login/${formProductType}?error=invalid_credentials`)
        : jsonError(
          401,
          'AUTH_INVALID_CREDENTIALS',
          'Invalid username or password.',
          false,
        );
      return finishResponse(response, {
        requestId,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        result: 'failure',
        startedAt,
      });
    }

    clearRateLimitOnSuccess(clientIp, username);
    const nextPath = body.next === '/simple-chat' ? '/simple-chat' : '/';
    const successPath = formProductType === 'chat'
      ? '/simple-chat'
      : `${nextPath}?loginMode=canvas`;
    const response = isFormSubmission
      ? redirectToPublicPath(request, successPath)
      : NextResponse.json({ success: true, user });
    const isHttps = request.nextUrl.protocol === 'https:'
      || request.headers.get('x-forwarded-proto') === 'https';
    response.cookies.set(WUJIE_SESSION_COOKIE, await createSessionToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      path: '/',
      maxAge: WUJIE_SESSION_TTL_SECONDS,
    });
    return finishResponse(response, {
      requestId,
      userId: user.id,
      result: 'success',
      startedAt,
    });
  } catch (error) {
    const serviceError = getRouteAuthError(error);
    const legacyConfigurationError = !serviceError && error instanceof AuthConfigurationError;
    const errorCode = serviceError?.code
      || (legacyConfigurationError ? 'AUTH_CONFIGURATION_UNAVAILABLE' : 'AUTH_LOGIN_FAILED');

    if (isFormSubmission) {
      const formError: FormError = serviceError
        ? formErrorForServiceCode(serviceError.code)
        : legacyConfigurationError
          ? 'configuration'
          : 'temporarily_unavailable';
      return finishResponse(
        redirectToPublicPath(request, `/login/${formProductType}?error=${formError}`),
        { requestId, errorCode, result: 'failure', startedAt },
      );
    }

    if (serviceError) {
      return finishResponse(jsonError(
        serviceError.status,
        serviceError.code,
        serviceError.message,
        serviceError.retryable,
      ), { requestId, errorCode, result: 'failure', startedAt });
    }
    if (legacyConfigurationError) {
      return finishResponse(jsonError(
        503,
        'AUTH_CONFIGURATION_UNAVAILABLE',
        AUTH_ROUTE_ERROR_CONTRACTS.AUTH_CONFIGURATION_UNAVAILABLE.message,
        true,
      ), { requestId, errorCode, result: 'failure', startedAt });
    }
    return finishResponse(jsonError(
      500,
      'AUTH_LOGIN_FAILED',
      'Authentication login is unavailable.',
      true,
    ), { requestId, errorCode, result: 'failure', startedAt });
  }
}
