import { NextRequest, NextResponse } from 'next/server';
import { AuthConfigurationError, getSessionUser } from '@/lib/server-auth';
import { AuthServiceError } from '@/lib/auth/auth-errors';

export const dynamic = 'force-dynamic';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
type RouteAuthServiceCode =
  | 'AUTH_CONFIGURATION_UNAVAILABLE'
  | 'AUTH_PERSISTENCE_UNAVAILABLE'
  | 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS'
  | 'AUTH_CREDENTIAL_FORMAT_INVALID';
type AuthPersistenceMode = 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';

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

interface SessionResultLog {
  requestId: string;
  userId?: string;
  errorCode?: string;
  persistenceMode?: AuthPersistenceMode;
  kid?: string;
  durationMs: number;
  result: 'success' | 'anonymous' | 'failure';
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

function finishResponse(
  response: NextResponse,
  input: Omit<SessionResultLog, 'durationMs' | 'persistenceMode' | 'kid'> & { startedAt: number },
): NextResponse {
  response.headers.set('x-request-id', input.requestId);
  const entry: SessionResultLog = {
    requestId: input.requestId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    durationMs: Math.max(0, Date.now() - input.startedAt),
    result: input.result,
  };
  const persistenceMode = getPersistenceModeForLog();
  if (persistenceMode) entry.persistenceMode = persistenceMode;
  try {
    console.info(entry);
  } catch {
    // Session responses must not depend on the runtime logger.
  }
  return response;
}

function jsonError(
  status: number,
  code: string,
  error: string,
  retryable: boolean,
): NextResponse {
  return NextResponse.json({ success: false, code, error, retryable }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  try {
    const user = await getSessionUser(request);
    return finishResponse(
      NextResponse.json({ success: true, user: user || null }),
      {
        requestId,
        ...(user ? { userId: user.id } : {}),
        result: user ? 'success' : 'anonymous',
        startedAt,
      },
    );
  } catch (error) {
    const serviceError = getRouteAuthError(error);
    const legacyConfigurationError = !serviceError && error instanceof AuthConfigurationError;
    if (serviceError) {
      return finishResponse(jsonError(
        serviceError.status,
        serviceError.code,
        serviceError.message,
        serviceError.retryable,
      ), {
        requestId,
        errorCode: serviceError.code,
        result: 'failure',
        startedAt,
      });
    }
    if (legacyConfigurationError) {
      return finishResponse(jsonError(
        503,
        'AUTH_CONFIGURATION_UNAVAILABLE',
        AUTH_ROUTE_ERROR_CONTRACTS.AUTH_CONFIGURATION_UNAVAILABLE.message,
        true,
      ), {
        requestId,
        errorCode: 'AUTH_CONFIGURATION_UNAVAILABLE',
        result: 'failure',
        startedAt,
      });
    }
    return finishResponse(jsonError(
      500,
      'AUTH_SESSION_UNAVAILABLE',
      'Authentication session is unavailable.',
      true,
    ), {
      requestId,
      errorCode: 'AUTH_SESSION_UNAVAILABLE',
      result: 'failure',
      startedAt,
    });
  }
}
