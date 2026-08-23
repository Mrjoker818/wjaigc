import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  class AuthConfigurationError extends Error {}

  return {
    AuthConfigurationError,
    authenticateUser: vi.fn(),
    createSessionToken: vi.fn(),
    ensureUserDataDirs: vi.fn(),
    getSessionUser: vi.fn(),
  };
});

vi.mock('@/lib/server-auth', () => ({
  AuthConfigurationError: mocks.AuthConfigurationError,
  authenticateUser: mocks.authenticateUser,
  createSessionToken: mocks.createSessionToken,
  getSessionUser: mocks.getSessionUser,
  WUJIE_SESSION_COOKIE: 'wujie_session',
  WUJIE_SESSION_TTL_SECONDS: 60 * 60 * 24 * 7,
}));
vi.mock('@/lib/server-user-storage', () => ({ ensureUserDataDirs: mocks.ensureUserDataDirs }));

import { POST } from '@/app/api/auth/login/route';
import { GET } from '@/app/api/auth/me/route';

interface LoginBody {
  name?: unknown;
  password?: unknown;
  productType?: string;
  next?: string;
  profile?: Record<string, unknown>;
}

interface MockAuthServiceError extends Error {
  code: string;
  httpStatus: 409 | 503;
  retryable: boolean;
}

const validUser = {
  id: 'user-1',
  name: 'admin',
  role: 'admin' as const,
};
const consoleCalls: unknown[][] = [];
let requestSequence = 0;

function nextIdentity(prefix: string): { ip: string; name: string } {
  requestSequence += 1;
  return {
    ip: `198.51.100.${(requestSequence % 250) + 1}`,
    name: `${prefix}-${requestSequence}`,
  };
}

function jsonRequest(
  body: LoginBody = { name: 'admin', password: 'password' },
  headers: Record<string, string> = {},
): NextRequest {
  const identity = nextIdentity('json-user');
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': identity.ip,
      ...headers,
    },
    body: JSON.stringify({ ...body, name: body.name ?? identity.name }),
  });
}

function formRequest(
  body: Record<string, string> = {
    name: 'admin',
    password: 'password',
    productType: 'canvas',
    next: '/',
  },
  headers: Record<string, string> = {},
): NextRequest {
  const identity = nextIdentity('form-user');
  return new NextRequest('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': identity.ip,
      ...headers,
    },
    body: new URLSearchParams({ ...body, name: body.name ?? identity.name }),
  });
}

function meRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/me', { headers });
}

function authServiceError(
  code: string,
  httpStatus: 409 | 503,
  retryable: boolean,
  message = 'SENSITIVE_INTERNAL_AUTH_ERROR_MESSAGE',
): MockAuthServiceError {
  return Object.assign(new Error(message), { code, httpStatus, retryable });
}

function consoleOutput(): string {
  return JSON.stringify(consoleCalls);
}

function expectRequestId(response: Response, expected?: string): string {
  const requestId = response.headers.get('x-request-id');
  expect(requestId).toBeTruthy();
  if (expected) expect(requestId).toBe(expected);
  return requestId!;
}

describe('authentication route contracts', () => {
  beforeEach(() => {
    mocks.authenticateUser.mockReset();
    mocks.createSessionToken.mockReset();
    mocks.createSessionToken.mockResolvedValue('session-token');
    mocks.ensureUserDataDirs.mockReset();
    mocks.getSessionUser.mockReset();
    consoleCalls.length = 0;
    vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => consoleCalls.push(args));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => consoleCalls.push(args));
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => consoleCalls.push(args));
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => consoleCalls.push(args));
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => consoleCalls.push(args));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns the complete JSON 400 contract for invalid input', async () => {
    const response = await POST(jsonRequest({ name: '', password: 'password' }, {
      'x-request-id': 'login.invalid-input:1',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      code: 'AUTH_INVALID_INPUT',
      error: 'Invalid login input.',
      retryable: false,
    });
    expectRequestId(response, 'login.invalid-input:1');
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
  });

  it('returns the same JSON 401 contract for every invalid username or password', async () => {
    mocks.authenticateUser.mockResolvedValue(null);
    const unknownUser = await POST(jsonRequest({
      name: 'SENSITIVE_UNKNOWN_ACCOUNT',
      password: 'SENSITIVE_BAD_PASSWORD_A',
    }));
    const existingUser = await POST(jsonRequest({
      name: 'SENSITIVE_EXISTING_ACCOUNT',
      password: 'SENSITIVE_BAD_PASSWORD_B',
    }));

    const expected = {
      success: false,
      code: 'AUTH_INVALID_CREDENTIALS',
      error: 'Invalid username or password.',
      retryable: false,
    };
    expect(unknownUser.status).toBe(401);
    expect(existingUser.status).toBe(401);
    expect(await unknownUser.json()).toEqual(expected);
    expect(await existingUser.json()).toEqual(expected);
    expectRequestId(unknownUser);
    expectRequestId(existingUser);
  });

  it('returns deterministic JSON 429 headers after five failures for one isolated key', async () => {
    mocks.authenticateUser.mockResolvedValue(null);
    const identity = nextIdentity('rate-limited-user');
    const buildRequest = () => jsonRequest({ name: identity.name, password: 'wrong' }, {
      'x-forwarded-for': identity.ip,
      'x-request-id': `rate.limit.${requestSequence}`,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(buildRequest())).status).toBe(401);
    }
    const response = await POST(buildRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      success: false,
      code: 'AUTH_TOO_MANY_ATTEMPTS',
      error: 'Too many login attempts. Please try again later.',
      retryable: true,
    });
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(response.headers.get('x-ratelimit-limit')).toBe('5');
    expectRequestId(response);
    expect(mocks.authenticateUser).toHaveBeenCalledTimes(5);
  });

  it.each([
    {
      error: authServiceError('AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS', 409, false),
      expected: {
        status: 409,
        code: 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS',
        message: 'Authentication credential rotation is unavailable.',
        retryable: false,
      },
    },
    {
      error: authServiceError('AUTH_CONFIGURATION_UNAVAILABLE', 503, true),
      expected: {
        status: 503,
        code: 'AUTH_CONFIGURATION_UNAVAILABLE',
        message: 'Authentication configuration is unavailable.',
        retryable: true,
      },
    },
    {
      error: authServiceError('AUTH_PERSISTENCE_UNAVAILABLE', 503, true),
      expected: {
        status: 503,
        code: 'AUTH_PERSISTENCE_UNAVAILABLE',
        message: 'Authentication persistence is unavailable.',
        retryable: true,
      },
    },
    {
      error: authServiceError('AUTH_CREDENTIAL_FORMAT_INVALID', 503, false),
      expected: {
        status: 503,
        code: 'AUTH_CREDENTIAL_FORMAT_INVALID',
        message: 'Authentication credential format is invalid.',
        retryable: false,
      },
    },
  ])('preserves the AuthServiceError JSON contract for $expected.code', async ({ error, expected }) => {
    mocks.authenticateUser.mockRejectedValue(error);

    const response = await POST(jsonRequest());

    expect(response.status).toBe(expected.status);
    expect(await response.json()).toEqual({
      success: false,
      code: expected.code,
      error: expected.message,
      retryable: expected.retryable,
    });
    expectRequestId(response);
  });

  it('keeps the historical AuthConfigurationError compatible without exposing its message', async () => {
    mocks.authenticateUser.mockRejectedValue(new mocks.AuthConfigurationError(
      'SENSITIVE_LEGACY_CONFIGURATION_MESSAGE',
    ));

    const response = await POST(jsonRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      error: 'Authentication configuration is unavailable.',
      retryable: true,
    });
    expectRequestId(response);
  });

  it('returns a fixed retryable JSON 500 contract for unknown failures', async () => {
    mocks.authenticateUser.mockRejectedValue(new Error('SENSITIVE_UNKNOWN_FAILURE'));

    const response = await POST(jsonRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      code: 'AUTH_LOGIN_FAILED',
      error: 'Authentication login is unavailable.',
      retryable: true,
    });
    expectRequestId(response);
  });

  it.each([
    {
      label: 'invalid input',
      body: { name: '', password: 'password' },
      rejection: null,
      expected: 'invalid_credentials',
    },
    {
      label: 'invalid credentials',
      body: { name: 'invalid-form-user', password: 'wrong' },
      rejection: null,
      resolved: null,
      expected: 'invalid_credentials',
    },
    {
      label: 'configuration service error',
      body: { name: 'configuration-form-user', password: 'password' },
      rejection: authServiceError('AUTH_CONFIGURATION_UNAVAILABLE', 503, true),
      expected: 'configuration',
    },
    {
      label: 'credential format service error',
      body: { name: 'credential-form-user', password: 'password' },
      rejection: authServiceError('AUTH_CREDENTIAL_FORMAT_INVALID', 503, false),
      expected: 'configuration',
    },
    {
      label: 'rotation service error',
      body: { name: 'rotation-form-user', password: 'password' },
      rejection: authServiceError('AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS', 409, false),
      expected: 'temporarily_unavailable',
    },
    {
      label: 'persistence service error',
      body: { name: 'persistence-form-user', password: 'password' },
      rejection: authServiceError('AUTH_PERSISTENCE_UNAVAILABLE', 503, true),
      expected: 'temporarily_unavailable',
    },
    {
      label: 'unknown error',
      body: { name: 'unknown-form-user', password: 'password' },
      rejection: new Error('SENSITIVE_FORM_FAILURE'),
      expected: 'temporarily_unavailable',
    },
  ])('maps $label to the closed form error enum', async ({ label, body, rejection, resolved, expected }) => {
    if (rejection) mocks.authenticateUser.mockRejectedValue(rejection);
    else if (label === 'invalid credentials') mocks.authenticateUser.mockResolvedValue(resolved);

    const response = await POST(formRequest(body, { 'x-request-id': `form.${expected}:1` }));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe(expected);
    expect([...location.searchParams.keys()]).toEqual(['error']);
    expect(location.href).not.toMatch(/AUTH_|SENSITIVE_|requestId|stack/i);
    expectRequestId(response, `form.${expected}:1`);
  });

  it('maps a form rate limit to too_many_attempts without waiting or sharing a test key', async () => {
    mocks.authenticateUser.mockResolvedValue(null);
    const identity = nextIdentity('form-rate-user');
    const buildRequest = () => formRequest({
      name: identity.name,
      password: 'wrong',
      productType: 'chat',
    }, {
      'x-forwarded-for': identity.ip,
      'x-request-id': 'form.rate-limit:1',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) await POST(buildRequest());
    const response = await POST(buildRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://localhost:5000/login/chat?error=too_many_attempts',
    );
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(response.headers.get('x-ratelimit-limit')).toBe('5');
    expectRequestId(response, 'form.rate-limit:1');
  });

  it('reuses a valid request id and replaces an invalid one consistently in response and logs', async () => {
    mocks.authenticateUser.mockResolvedValue(validUser);
    const validResponse = await POST(jsonRequest(undefined, {
      'x-request-id': 'valid.Request-Id:123',
    }));

    expectRequestId(validResponse, 'valid.Request-Id:123');
    expect(consoleCalls.some(call => (
      typeof call[0] === 'object'
      && call[0] !== null
      && (call[0] as { requestId?: string }).requestId === 'valid.Request-Id:123'
    ))).toBe(true);

    consoleCalls.length = 0;
    const invalidResponse = await POST(jsonRequest(undefined, {
      'x-request-id': 'invalid request id with spaces',
    }));
    const generatedRequestId = expectRequestId(invalidResponse);

    expect(generatedRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(generatedRequestId).not.toBe('invalid request id with spaces');
    expect(consoleCalls.some(call => (
      typeof call[0] === 'object'
      && call[0] !== null
      && (call[0] as { requestId?: string }).requestId === generatedRequestId
    ))).toBe(true);

    consoleCalls.length = 0;
    const overlongResponse = await POST(jsonRequest(undefined, {
      'x-request-id': 'a'.repeat(129),
    }));
    const replacementForOverlongId = expectRequestId(overlongResponse);
    expect(replacementForOverlongId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(replacementForOverlongId).not.toBe('a'.repeat(129));
  });

  it('keeps deferred credential migration successful for JSON and form logins', async () => {
    mocks.authenticateUser.mockResolvedValue(validUser);
    mocks.createSessionToken.mockResolvedValue('migration-deferred-session');

    const jsonResponse = await POST(jsonRequest());
    const formResponse = await POST(formRequest({
      name: 'migration-form-user',
      password: 'correct-legacy-password',
      productType: 'canvas',
    }));

    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({ success: true, user: validUser });
    expect(jsonResponse.cookies.get('wujie_session')?.value).toBe('migration-deferred-session');
    expect(jsonResponse.headers.get('set-cookie')).not.toMatch(/Secure/i);
    expect(formResponse.status).toBe(303);
    expect(formResponse.headers.get('location')).toBe('http://localhost:5000/?loginMode=canvas');
    expect(formResponse.cookies.get('wujie_session')?.value).toBe('migration-deferred-session');
    expectRequestId(jsonResponse);
    expectRequestId(formResponse);
  });

  it('preserves the seven-day secure cookie contract and public deployment redirect', async () => {
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://workspace.example.test');
    mocks.authenticateUser.mockResolvedValue(validUser);
    mocks.createSessionToken.mockResolvedValue('session-token');

    const response = await POST(formRequest({
      name: 'admin',
      password: 'password',
      productType: 'canvas',
      next: '/',
    }, {
      'x-forwarded-proto': 'https',
      'x-request-id': 'secure.cookie:1',
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://workspace.example.test/?loginMode=canvas');
    expect(response.cookies.get('wujie_session')?.value).toBe('session-token');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=lax/i);
    expect(response.headers.get('set-cookie')).toContain('Path=/');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=604800');
    expect(response.headers.get('set-cookie')).toMatch(/Secure/i);
    expectRequestId(response, 'secure.cookie:1');
    expect(mocks.ensureUserDataDirs).not.toHaveBeenCalled();
  });

  it('never emits request secrets, profiles, internal errors, tokens, hashes, or connection strings', async () => {
    const sentinels = [
      'SENSITIVE_USERNAME_SENTINEL',
      'SENSITIVE_PASSWORD_SENTINEL',
      'SENSITIVE_PROFILE_SENTINEL',
      'SENSITIVE_TOKEN_SENTINEL',
      'SENSITIVE_SECRET_HASH_SENTINEL',
      'postgres://SENSITIVE_CONNECTION_SENTINEL@database/auth',
    ];
    vi.stubEnv('DATABASE_URL', sentinels[5]);
    mocks.authenticateUser.mockRejectedValue(new Error(sentinels.join('|')));

    const response = await POST(jsonRequest({
      name: sentinels[0],
      password: sentinels[1],
      profile: { biography: sentinels[2], token: sentinels[3], hash: sentinels[4] },
    }, { 'x-request-id': 'safe.failure:1' }));
    const body = await response.text();
    const surfaces = JSON.stringify({
      body,
      headers: Object.fromEntries(response.headers.entries()),
      console: consoleOutput(),
    });

    for (const sentinel of sentinels) expect(surfaces).not.toContain(sentinel);
  });

  it('writes one structured result log using only the approved authentication fields', async () => {
    vi.stubEnv('WUJIE_AUTH_PERSISTENCE_MODE', 'DB_ONLY');
    mocks.authenticateUser.mockResolvedValue(validUser);

    const response = await POST(jsonRequest(undefined, { 'x-request-id': 'structured.log:1' }));

    expect(response.status).toBe(200);
    expect(consoleCalls).toHaveLength(1);
    const entry = consoleCalls[0]?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      requestId: 'structured.log:1',
      userId: 'user-1',
      persistenceMode: 'DB_ONLY',
      result: 'success',
    });
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(Object.keys(entry).sort()).toEqual([
      'durationMs',
      'persistenceMode',
      'requestId',
      'result',
      'userId',
    ]);
  });

  it('keeps anonymous /api/auth/me successful and correlated', async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(meRequest({ 'x-request-id': 'session.anonymous:1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, user: null });
    expectRequestId(response, 'session.anonymous:1');
    expect(consoleCalls).toHaveLength(1);
    expect(consoleCalls[0]?.[0]).toMatchObject({
      requestId: 'session.anonymous:1',
      result: 'anonymous',
    });
  });

  it('maps /api/auth/me AuthServiceError to its fixed 503 JSON contract', async () => {
    mocks.getSessionUser.mockRejectedValue(authServiceError(
      'AUTH_PERSISTENCE_UNAVAILABLE',
      503,
      true,
      'SENSITIVE_SESSION_PERSISTENCE_MESSAGE',
    ));

    const response = await GET(meRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      error: 'Authentication persistence is unavailable.',
      retryable: true,
    });
    expectRequestId(response);
    expect(consoleOutput()).not.toContain('SENSITIVE_SESSION_PERSISTENCE_MESSAGE');
  });

  it('maps unknown /api/auth/me errors to a fixed safe 500 contract', async () => {
    mocks.getSessionUser.mockRejectedValue(new Error('SENSITIVE_SESSION_UNKNOWN_MESSAGE'));

    const response = await GET(meRequest({ 'x-request-id': 'session.failure:1' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      code: 'AUTH_SESSION_UNAVAILABLE',
      error: 'Authentication session is unavailable.',
      retryable: true,
    });
    expectRequestId(response, 'session.failure:1');
    expect(JSON.stringify({ body, console: consoleOutput() })).not.toContain(
      'SENSITIVE_SESSION_UNKNOWN_MESSAGE',
    );
  });
});
