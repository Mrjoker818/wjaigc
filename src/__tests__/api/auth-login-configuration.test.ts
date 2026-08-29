import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthServiceError, type AuthErrorCode } from '@/lib/auth/auth-errors';

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
  code: AuthErrorCode,
  httpStatus: 409 | 503,
  retryable: boolean,
  message = 'SENSITIVE_INTERNAL_AUTH_ERROR_MESSAGE',
): AuthServiceError {
  return new AuthServiceError(code, message, httpStatus, retryable);
}

function authServiceErrorWithRuntimeCode(code: string): AuthServiceError {
  const error = authServiceError('AUTH_CONFIGURATION_UNAVAILABLE', 503, true);
  Object.defineProperty(error, 'code', { configurable: true, value: code });
  return error;
}

const ALLOWED_AUTH_LOG_FIELDS = new Set([
  'requestId',
  'userId',
  'errorCode',
  'persistenceMode',
  'kid',
  'durationMs',
  'result',
]);

function inspectOwnValues(value: unknown): string[] {
  const inspected: string[] = [];
  const seen = new Set<object>();

  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      inspected.push(candidate);
      return;
    }
    if (typeof candidate === 'symbol') {
      inspected.push(String(candidate));
      return;
    }
    if ((typeof candidate !== 'object' || candidate === null) && typeof candidate !== 'function') {
      return;
    }

    const inspectable = candidate as object;
    if (seen.has(inspectable)) return;
    seen.add(inspectable);

    if (typeof candidate === 'function') {
      inspected.push(Function.prototype.toString.call(candidate));
    }
    if (candidate instanceof Error) {
      visit(candidate.name);
      visit(candidate.message);
      visit(candidate.stack);
      visit(candidate.cause);
    }

    let propertyNames: string[];
    let propertySymbols: symbol[];
    try {
      propertyNames = Object.getOwnPropertyNames(inspectable);
      propertySymbols = Object.getOwnPropertySymbols(inspectable);
    } catch {
      throw new Error('Unable to inspect a console argument safely.');
    }

    for (const key of [...propertyNames, ...propertySymbols]) {
      visit(key);
      const descriptor = Object.getOwnPropertyDescriptor(inspectable, key);
      if (!descriptor) continue;
      if ('value' in descriptor) visit(descriptor.value);
      else {
        visit(descriptor.get);
        visit(descriptor.set);
      }
    }
  };

  visit(value);
  return inspected;
}

function assertNoSensitiveValues(value: unknown, sentinels: readonly string[]): void {
  const inspected = inspectOwnValues(value);
  for (const sentinel of sentinels) {
    if (inspected.some(fragment => fragment.includes(sentinel))) {
      throw new Error(`Sensitive sentinel detected: ${sentinel}`);
    }
  }
}

function assertStructuredAuthLogs(calls: readonly unknown[][]): void {
  for (const call of calls) {
    if (call.length !== 1 || typeof call[0] !== 'object' || call[0] === null || Array.isArray(call[0])) {
      throw new Error('Authentication result logs must contain exactly one structured object.');
    }
    if (Object.getOwnPropertySymbols(call[0]).length > 0) {
      throw new Error('Authentication result logs must not contain symbol fields.');
    }
    for (const field of Object.getOwnPropertyNames(call[0])) {
      if (!ALLOWED_AUTH_LOG_FIELDS.has(field)) {
        throw new Error(`Authentication result log contains disallowed field: ${field}`);
      }
    }
  }
}

function expectRequestId(response: Response, expected?: string): string {
  const requestId = response.headers.get('x-request-id');
  expect(requestId).toBeTruthy();
  if (expected) expect(requestId).toBe(expected);
  return requestId!;
}

describe('authentication route contracts', () => {
  beforeEach(() => {
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
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
    assertStructuredAuthLogs(vi.mocked(console.info).mock.calls);
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
      error: authServiceError('AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS', 503, true),
      expected: {
        status: 409,
        code: 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS',
        message: 'Authentication credential rotation is unavailable.',
        retryable: false,
      },
    },
    {
      error: authServiceError('AUTH_CONFIGURATION_UNAVAILABLE', 409, false),
      expected: {
        status: 503,
        code: 'AUTH_CONFIGURATION_UNAVAILABLE',
        message: 'Authentication configuration is unavailable.',
        retryable: true,
      },
    },
    {
      error: authServiceError('AUTH_PERSISTENCE_UNAVAILABLE', 409, false),
      expected: {
        status: 503,
        code: 'AUTH_PERSISTENCE_UNAVAILABLE',
        message: 'Authentication persistence is unavailable.',
        retryable: true,
      },
    },
    {
      error: authServiceError('AUTH_CREDENTIAL_FORMAT_INVALID', 409, true),
      expected: {
        status: 503,
        code: 'AUTH_CREDENTIAL_FORMAT_INVALID',
        message: 'Authentication credential format is invalid.',
        retryable: false,
      },
    },
  ])('derives the fixed route contract for real AuthServiceError $expected.code', async ({ error, expected }) => {
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

  it.each([
    {
      label: 'plain object with a valid code',
      error: {
        code: 'AUTH_CONFIGURATION_UNAVAILABLE',
        httpStatus: 503,
        retryable: true,
        message: 'SENSITIVE_FAKE_SERVICE_ERROR',
      },
    },
    { label: 'Object.prototype toString key', error: authServiceErrorWithRuntimeCode('toString') },
    { label: 'Object.prototype constructor key', error: authServiceErrorWithRuntimeCode('constructor') },
    { label: 'Object.prototype __proto__ key', error: authServiceErrorWithRuntimeCode('__proto__') },
    { label: 'unknown code', error: authServiceErrorWithRuntimeCode('AUTH_UNKNOWN_SERVICE_ERROR') },
    {
      label: 'deferred migration crossing the route boundary',
      error: authServiceError('AUTH_CREDENTIAL_MIGRATION_DEFERRED', 503, true),
    },
  ])('treats $label as a fixed unknown login failure', async ({ error }) => {
    mocks.authenticateUser.mockRejectedValue(error);

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
      label: 'deferred migration crossing the route boundary',
      body: { name: 'deferred-form-user', password: 'password' },
      rejection: authServiceError('AUTH_CREDENTIAL_MIGRATION_DEFERRED', 503, true),
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

  it('preserves every critical response contract when console.info throws', async () => {
    vi.mocked(console.info).mockImplementation(() => {
      throw new Error('SENSITIVE_LOGGER_FAILURE');
    });

    mocks.authenticateUser.mockResolvedValue(validUser);
    const jsonSuccess = await POST(jsonRequest(undefined, { 'x-request-id': 'logger.json-success:1' }));
    expect(jsonSuccess.status).toBe(200);
    expect(await jsonSuccess.json()).toEqual({ success: true, user: validUser });
    expect(jsonSuccess.cookies.get('wujie_session')?.value).toBe('session-token');
    expectRequestId(jsonSuccess, 'logger.json-success:1');

    const formSuccess = await POST(formRequest({
      name: 'logger-form-user',
      password: 'password',
      productType: 'canvas',
      next: '/',
    }, { 'x-request-id': 'logger.form-success:1' }));
    expect(formSuccess.status).toBe(303);
    expect(formSuccess.headers.get('location')).toBe('http://localhost:5000/?loginMode=canvas');
    expect(formSuccess.cookies.get('wujie_session')?.value).toBe('session-token');
    expectRequestId(formSuccess, 'logger.form-success:1');

    mocks.authenticateUser.mockResolvedValue(null);
    const invalidCredentials = await POST(jsonRequest({
      name: 'logger-invalid-user',
      password: 'wrong',
    }, { 'x-request-id': 'logger.invalid:1' }));
    expect(invalidCredentials.status).toBe(401);
    expect(await invalidCredentials.json()).toEqual({
      success: false,
      code: 'AUTH_INVALID_CREDENTIALS',
      error: 'Invalid username or password.',
      retryable: false,
    });
    expectRequestId(invalidCredentials, 'logger.invalid:1');

    const rateIdentity = nextIdentity('logger-rate-user');
    const buildRateRequest = () => jsonRequest({
      name: rateIdentity.name,
      password: 'wrong',
    }, {
      'x-forwarded-for': rateIdentity.ip,
      'x-request-id': 'logger.rate-limit:1',
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(buildRateRequest())).status).toBe(401);
    }
    const rateLimited = await POST(buildRateRequest());
    expect(rateLimited.status).toBe(429);
    expect(await rateLimited.json()).toEqual({
      success: false,
      code: 'AUTH_TOO_MANY_ATTEMPTS',
      error: 'Too many login attempts. Please try again later.',
      retryable: true,
    });
    expect(Number(rateLimited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(rateLimited.headers.get('x-ratelimit-limit')).toBe('5');
    expectRequestId(rateLimited, 'logger.rate-limit:1');

    mocks.authenticateUser.mockRejectedValue(authServiceError(
      'AUTH_CONFIGURATION_UNAVAILABLE',
      409,
      false,
    ));
    const serviceFailure = await POST(jsonRequest(undefined, {
      'x-request-id': 'logger.service-failure:1',
    }));
    expect(serviceFailure.status).toBe(503);
    expect(await serviceFailure.json()).toEqual({
      success: false,
      code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      error: 'Authentication configuration is unavailable.',
      retryable: true,
    });
    expectRequestId(serviceFailure, 'logger.service-failure:1');

    mocks.getSessionUser.mockResolvedValue(null);
    const anonymousSession = await GET(meRequest({ 'x-request-id': 'logger.session-anonymous:1' }));
    expect(anonymousSession.status).toBe(200);
    expect(await anonymousSession.json()).toEqual({ success: true, user: null });
    expectRequestId(anonymousSession, 'logger.session-anonymous:1');

    mocks.getSessionUser.mockRejectedValue(authServiceError(
      'AUTH_PERSISTENCE_UNAVAILABLE',
      409,
      false,
    ));
    const sessionFailure = await GET(meRequest({ 'x-request-id': 'logger.session-failure:1' }));
    expect(sessionFailure.status).toBe(503);
    expect(await sessionFailure.json()).toEqual({
      success: false,
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      error: 'Authentication persistence is unavailable.',
      retryable: true,
    });
    expectRequestId(sessionFailure, 'logger.session-failure:1');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('self-validates the console auditor against hidden Error fields, causes, symbols, functions, and strings', () => {
    const hiddenMessage = new Error('SENSITIVE_AUDIT_MESSAGE');
    Object.defineProperty(hiddenMessage, 'stack', { value: 'benign stack' });
    const hiddenStack = new Error('benign message');
    Object.defineProperty(hiddenStack, 'stack', { value: 'SENSITIVE_AUDIT_STACK' });
    const hiddenCause = new Error('benign message', {
      cause: { nested: 'SENSITIVE_AUDIT_CAUSE' },
    });
    Object.defineProperty(hiddenCause, 'stack', { value: 'benign stack' });
    const symbolValue = {};
    Object.defineProperty(symbolValue, Symbol('SENSITIVE_AUDIT_SYMBOL'), { value: 'benign' });
    const sensitiveFunction = function SENSITIVE_AUDIT_FUNCTION(): void {};

    expect(() => assertNoSensitiveValues(hiddenMessage, ['SENSITIVE_AUDIT_MESSAGE'])).toThrow();
    expect(() => assertNoSensitiveValues(hiddenStack, ['SENSITIVE_AUDIT_STACK'])).toThrow();
    expect(() => assertNoSensitiveValues(hiddenCause, ['SENSITIVE_AUDIT_CAUSE'])).toThrow();
    expect(() => assertNoSensitiveValues(symbolValue, ['SENSITIVE_AUDIT_SYMBOL'])).toThrow();
    expect(() => assertNoSensitiveValues(sensitiveFunction, ['SENSITIVE_AUDIT_FUNCTION'])).toThrow();
    expect(() => assertNoSensitiveValues('SENSITIVE_AUDIT_STRING', ['SENSITIVE_AUDIT_STRING'])).toThrow();
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

    const jsonResponse = await POST(jsonRequest({
      name: sentinels[0],
      password: sentinels[1],
      profile: { biography: sentinels[2], token: sentinels[3], hash: sentinels[4] },
    }, { 'x-request-id': 'safe.failure:1' }));
    const formResponse = await POST(formRequest({
      name: sentinels[0],
      password: sentinels[1],
      productType: 'canvas',
    }, { 'x-request-id': 'safe.form-failure:1' }));

    const responseSurfaces = [
      await jsonResponse.text(),
      [...jsonResponse.headers.entries()],
      jsonResponse.headers.get('location'),
      await formResponse.text(),
      [...formResponse.headers.entries()],
      formResponse.headers.get('location'),
    ];
    expect(() => assertNoSensitiveValues(responseSurfaces, sentinels)).not.toThrow();
    expect(() => assertNoSensitiveValues(consoleCalls, sentinels)).not.toThrow();
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
      409,
      false,
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
    expect(() => assertNoSensitiveValues(
      consoleCalls,
      ['SENSITIVE_SESSION_PERSISTENCE_MESSAGE'],
    )).not.toThrow();
  });

  it.each([
    {
      label: 'a fake service error object',
      error: {
        code: 'AUTH_PERSISTENCE_UNAVAILABLE',
        httpStatus: 503,
        retryable: true,
      },
    },
    {
      label: 'a prototype-chain code',
      error: authServiceErrorWithRuntimeCode('constructor'),
    },
    {
      label: 'deferred migration crossing the session boundary',
      error: authServiceError('AUTH_CREDENTIAL_MIGRATION_DEFERRED', 503, true),
    },
  ])('maps $label to the fixed unknown session contract', async ({ error }) => {
    mocks.getSessionUser.mockRejectedValue(error);

    const response = await GET(meRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      code: 'AUTH_SESSION_UNAVAILABLE',
      error: 'Authentication session is unavailable.',
      retryable: true,
    });
    expectRequestId(response);
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
    expect(() => assertNoSensitiveValues(
      [body, [...response.headers.entries()], response.headers.get('location'), consoleCalls],
      ['SENSITIVE_SESSION_UNKNOWN_MESSAGE'],
    )).not.toThrow();
  });
});
