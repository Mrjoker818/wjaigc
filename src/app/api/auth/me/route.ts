import { NextRequest, NextResponse } from 'next/server';
import { AuthConfigurationError, getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const AUTH_SERVICE_PUBLIC_MESSAGES = {
  AUTH_CONFIGURATION_UNAVAILABLE: 'Authentication configuration is unavailable.',
  AUTH_PERSISTENCE_UNAVAILABLE: 'Authentication persistence is unavailable.',
  AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS: 'Authentication credential rotation is unavailable.',
  AUTH_CREDENTIAL_FORMAT_INVALID: 'Authentication credential format is invalid.',
  AUTH_CREDENTIAL_MIGRATION_DEFERRED: 'Authentication credential migration is deferred.',
} as const;

type AuthServiceCode = keyof typeof AUTH_SERVICE_PUBLIC_MESSAGES;
type AuthPersistenceMode = 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';

interface AuthServiceErrorShape {
  code: AuthServiceCode;
  httpStatus: 409 | 503;
  retryable: boolean;
}

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

function isAuthServiceError(error: unknown): error is AuthServiceErrorShape {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<AuthServiceErrorShape>;
  return typeof candidate.code === 'string'
    && candidate.code in AUTH_SERVICE_PUBLIC_MESSAGES
    && (candidate.httpStatus === 409 || candidate.httpStatus === 503)
    && typeof candidate.retryable === 'boolean';
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
  console.info(entry);
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
    const serviceError = isAuthServiceError(error) ? error : null;
    const legacyConfigurationError = !serviceError && error instanceof AuthConfigurationError;
    if (serviceError) {
      return finishResponse(jsonError(
        serviceError.httpStatus,
        serviceError.code,
        AUTH_SERVICE_PUBLIC_MESSAGES[serviceError.code],
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
        AUTH_SERVICE_PUBLIC_MESSAGES.AUTH_CONFIGURATION_UNAVAILABLE,
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
