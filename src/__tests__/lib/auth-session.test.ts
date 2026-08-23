import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSessionPayload, resolveSessionUser } from '@/lib/auth-session';
import {
  deriveAuthSecretKid,
  type AuthSecretRingV1,
} from '@/lib/auth/auth-secret-ring';
import type { User } from '@/lib/user-types';

vi.mock('server-only', () => ({}));

const serverAuthMocks = vi.hoisted(() => ({
  dbDeleteUser: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbInitCredits: vi.fn(),
  dbReadUsers: vi.fn(),
  dbWriteUsers: vi.fn(),
  getRuntimeSettings: vi.fn(),
  readDatabaseSecretRing: vi.fn(),
  resolveDatabaseSecretRing: vi.fn(),
  updateUserCredentialSidecar: vi.fn(),
  updateUserCredentials: vi.fn(),
  updateUserProfileFields: vi.fn(),
  writeAuthJsonFileAtomic: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ isDatabaseConfigured: () => true }));
vi.mock('@/lib/db-storage', () => ({
  dbDeleteUser: serverAuthMocks.dbDeleteUser,
  dbDeleteUserData: serverAuthMocks.dbDeleteUserData,
  dbInitCredits: serverAuthMocks.dbInitCredits,
  dbReadUsers: serverAuthMocks.dbReadUsers,
  dbWriteUsers: serverAuthMocks.dbWriteUsers,
}));
vi.mock('@/lib/auth/auth-repository', () => ({
  readDatabaseSecretRing: serverAuthMocks.readDatabaseSecretRing,
  resolveDatabaseSecretRing: serverAuthMocks.resolveDatabaseSecretRing,
  updateUserCredentialSidecar: serverAuthMocks.updateUserCredentialSidecar,
  updateUserCredentials: serverAuthMocks.updateUserCredentials,
  updateUserProfileFields: serverAuthMocks.updateUserProfileFields,
}));
vi.mock('@/lib/auth/auth-persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/auth/auth-persistence')>();
  return {
    ...actual,
    writeAuthJsonFileAtomic: serverAuthMocks.writeAuthJsonFileAtomic,
  };
});
vi.mock('@/lib/runtime-settings', () => ({
  getRuntimeSettings: serverAuthMocks.getRuntimeSettings,
}));

const originalEnvironment = { ...process.env };
const sessionNow = 1_800_000_000_000;
const sessionTtlSeconds = 7 * 24 * 60 * 60;
const activeSecret = 'task-seven-active-session-secret-0123456789abcdef';
const previousSecret = 'task-seven-previous-session-secret-0123456789abcd';
let temporaryDataDirectory: string | null = null;
const sessionUser = {
  id: 'session-contract-user',
  name: 'session-contract-admin',
  role: 'admin',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as const;

function createSecretRing(retiredAt = sessionNow - 60_000): AuthSecretRingV1 {
  return {
    version: 1,
    active: {
      kid: deriveAuthSecretKid(activeSecret),
      secret: activeSecret,
      activatedAt: retiredAt,
    },
    previous: {
      kid: deriveAuthSecretKid(previousSecret),
      secret: previousSecret,
      activatedAt: retiredAt - 60_000,
      retiredAt,
    },
    updatedAt: retiredAt,
  };
}

function configureServerAuth(
  ring = createSecretRing(),
  options: {
    mode?: 'DB_ONLY' | 'DB_PLUS_FILE' | 'FILE_ONLY';
    defaultAdminName?: string;
    configuredSecret?: string | null;
  } = {},
): void {
  process.env.COZE_PROJECT_ENV = 'DEV';
  process.env.WUJIE_AUTH_PERSISTENCE_MODE = options.mode ?? 'DB_ONLY';
  process.env.WUJIE_ADMIN_USERNAME = options.defaultAdminName ?? sessionUser.name;
  process.env.WUJIE_ADMIN_PASSWORD = 'session-read-only-bootstrap-password';
  if (options.configuredSecret === undefined || options.configuredSecret === null) {
    delete process.env.WUJIE_AUTH_SECRET;
  } else {
    process.env.WUJIE_AUTH_SECRET = options.configuredSecret;
  }
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS;
  serverAuthMocks.readDatabaseSecretRing.mockResolvedValue(ring);
  serverAuthMocks.resolveDatabaseSecretRing.mockResolvedValue(ring);
  serverAuthMocks.dbWriteUsers.mockResolvedValue(true);
  serverAuthMocks.dbReadUsers.mockResolvedValue([{
    id: sessionUser.id,
    name: sessionUser.name,
    password_hash: 'unused-session-contract-password-hash',
    credential_hash: null,
    role: sessionUser.role,
    status: sessionUser.status,
    product_type: 'canvas,chat',
    group_id: null,
    chat_models: null,
    image_models: null,
    daily_token_limit: null,
    monthly_token_limit: null,
    daily_image_limit: null,
    avatar: null,
    nickname: null,
    api_permissions: { image: true, chat: true },
    storage_folder: `data/users/${sessionUser.id}`,
    email: null,
    created_at: sessionUser.createdAt,
    updated_at: sessionUser.updatedAt,
  }]);
  serverAuthMocks.getRuntimeSettings.mockResolvedValue({ initialCredits: 0 });
}

function storedFileUser(): Record<string, unknown> {
  return {
    id: sessionUser.id,
    name: sessionUser.name,
    passwordHash: 'unused-session-contract-password-hash',
    role: sessionUser.role,
    status: sessionUser.status,
    productType: 'canvas,chat',
    apiPermissions: { image: true, chat: true },
    storageFolder: `data/users/${sessionUser.id}`,
    createdAt: sessionUser.createdAt,
    updatedAt: sessionUser.updatedAt,
  };
}

async function configureFileSessionFixture(input: {
  secretFile?: string;
  includeUsers?: boolean;
  configuredSecret?: string | null;
}): Promise<{ ringPath: string; usersPath: string }> {
  temporaryDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'wujie-session-read-only-'));
  const systemDirectory = path.join(temporaryDataDirectory, 'system');
  const ringPath = path.join(systemDirectory, 'auth-secret');
  const usersPath = path.join(systemDirectory, 'users.json');
  await mkdir(systemDirectory, { recursive: true });
  if (input.secretFile !== undefined) {
    await writeFile(ringPath, input.secretFile, 'utf8');
  }
  if (input.includeUsers !== false) {
    await writeFile(usersPath, JSON.stringify({
      users: [storedFileUser()],
      updatedAt: 1,
    }), 'utf8');
  }
  process.env.WUJIE_DATA_DIR = temporaryDataDirectory;
  configureServerAuth(createSecretRing(), {
    mode: 'FILE_ONLY',
    defaultAdminName: 'missing-default-administrator',
    configuredSecret: input.configuredSecret,
  });
  vi.resetModules();
  return { ringPath, usersPath };
}

function sessionPayload(input: { kid?: string; exp?: number } = {}): Record<string, unknown> {
  return {
    sub: sessionUser.id,
    role: sessionUser.role,
    name: sessionUser.name,
    exp: input.exp ?? sessionNow + 60_000,
    ...(input.kid === undefined ? {} : { kid: input.kid }),
  };
}

function expectNoSessionWrites(): void {
  expect(serverAuthMocks.dbInitCredits).not.toHaveBeenCalled();
  expect(serverAuthMocks.dbWriteUsers).not.toHaveBeenCalled();
  expect(serverAuthMocks.resolveDatabaseSecretRing).not.toHaveBeenCalled();
  expect(serverAuthMocks.updateUserCredentialSidecar).not.toHaveBeenCalled();
  expect(serverAuthMocks.updateUserCredentials).not.toHaveBeenCalled();
  expect(serverAuthMocks.updateUserProfileFields).not.toHaveBeenCalled();
  expect(serverAuthMocks.writeAuthJsonFileAtomic).not.toHaveBeenCalled();
}

function signEncodedPayload(encoded: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function signSessionPayload(payload: unknown, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return signEncodedPayload(encoded, secret);
}

function requestWithSession(token: string): NextRequest {
  return {
    cookies: {
      get: (name: string) => name === 'wujie_session'
        ? { name, value: token }
        : undefined,
    },
  } as unknown as NextRequest;
}

afterEach(async () => {
  vi.useRealTimers();
  if (temporaryDataDirectory) {
    await rm(temporaryDataDirectory, { recursive: true, force: true });
    temporaryDataDirectory = null;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('fetchSessionPayload', () => {
  it('rejects and aborts when a browser-wrapped fetch never settles', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const request = fetchSessionPayload(hangingFetch, 10);
    const rejectedRequest = expect(request).rejects.toThrow('Session request timed out');
    await vi.advanceTimersByTimeAsync(10);

    await rejectedRequest;
    expect(requestSignal?.aborted).toBe(true);
    expect(hangingFetch).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include',
    }));
  });

  it('preserves an authenticated user when the session service returns a transient failure', () => {
    const authenticatedUser = {
      id: 'user-1',
      name: 'Authenticated user',
      role: 'user',
    } as User;

    expect(resolveSessionUser(authenticatedUser, {
      success: false,
    })).toEqual({ status: 'indeterminate', user: authenticatedUser });
  });

  it('clears an authenticated user only when the session service explicitly reports no user', () => {
    const authenticatedUser = {
      id: 'user-1',
      name: 'Authenticated user',
      role: 'user',
    } as User;

    expect(resolveSessionUser(authenticatedUser, {
      success: true,
      user: null,
    })).toEqual({ status: 'unauthenticated', user: null });
  });
});

describe.sequential('server authentication sessions', () => {
  it('signs new sessions with only the active secret and includes its kid and seven-day expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const ring = createSecretRing();
    configureServerAuth(ring);
    const {
      createSessionToken,
      WUJIE_SESSION_COOKIE,
      WUJIE_SESSION_TTL_SECONDS,
    } = await import('@/lib/server-auth');

    const token = await createSessionToken(sessionUser as User);
    const [encoded, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      sub: string;
      role: string;
      name: string;
      exp: number;
      kid?: string;
    };

    expect(WUJIE_SESSION_COOKIE).toBe('wujie_session');
    expect(WUJIE_SESSION_TTL_SECONDS).toBe(sessionTtlSeconds);
    expect(payload).toEqual({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + sessionTtlSeconds * 1_000,
      kid: ring.active.kid,
    });
    expect(signature).toBe(createHmac('sha256', activeSecret).update(encoded).digest('base64url'));
    expect(signature).not.toBe(
      createHmac('sha256', previousSecret).update(encoded).digest('base64url'),
    );
  });

  it('uses only the kid-selected active or previous entry and rejects unknown kids', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const ring = createSecretRing();
    configureServerAuth(ring);
    const { getSessionUser } = await import('@/lib/server-auth');
    const basePayload = {
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
    };

    const activePayload = { ...basePayload, kid: ring.active.kid };
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(activePayload, activeSecret),
    ))).resolves.toMatchObject({ id: sessionUser.id });
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(activePayload, previousSecret),
    ))).resolves.toBeNull();

    const previousPayload = { ...basePayload, kid: ring.previous?.kid };
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(previousPayload, previousSecret),
    ))).resolves.toMatchObject({ id: sessionUser.id });
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(previousPayload, activeSecret),
    ))).resolves.toBeNull();

    const unknownPayload = { ...basePayload, kid: 'unknown-kid-0000' };
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(unknownPayload, activeSecret),
    ))).resolves.toBeNull();
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(unknownPayload, previousSecret),
    ))).resolves.toBeNull();
  });

  it('accepts legacy sessions without kid in controlled active then previous order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    configureServerAuth();
    const { getSessionUser } = await import('@/lib/server-auth');
    const legacyPayload = {
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
    };

    await expect(getSessionUser(requestWithSession(
      signSessionPayload(legacyPayload, activeSecret),
    ))).resolves.toMatchObject({ id: sessionUser.id });
    await expect(getSessionUser(requestWithSession(
      signSessionPayload(legacyPayload, previousSecret),
    ))).resolves.toMatchObject({ id: sessionUser.id });
  });

  it('disables previous sessions only for the exact false switch value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const ring = createSecretRing();
    configureServerAuth(ring);
    const { getSessionUser } = await import('@/lib/server-auth');
    const token = signSessionPayload({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
      kid: ring.previous?.kid,
    }, previousSecret);

    process.env.WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS = 'false';
    await expect(getSessionUser(requestWithSession(token))).resolves.toBeNull();

    process.env.WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS = 'FALSE';
    await expect(getSessionUser(requestWithSession(token))).resolves.toMatchObject({
      id: sessionUser.id,
    });
  });

  it('rejects expired previous sessions before reading the user store', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const ring = createSecretRing();
    configureServerAuth(ring);
    const { getSessionUser } = await import('@/lib/server-auth');
    const token = signSessionPayload({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow - 1,
      kid: ring.previous?.kid,
    }, previousSecret);

    await expect(getSessionUser(requestWithSession(token))).resolves.toBeNull();
    expect(serverAuthMocks.dbReadUsers).not.toHaveBeenCalled();
  });

  it('rejects exp equal to now, accepts now plus one, and captures verification time once', async () => {
    configureServerAuth();
    const { getSessionUser } = await import('@/lib/server-auth');
    let nowSpy = vi.spyOn(Date, 'now').mockReturnValue(sessionNow);

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: deriveAuthSecretKid(activeSecret), exp: sessionNow }),
      activeSecret,
    )))).resolves.toBeNull();
    expect(nowSpy).toHaveBeenCalledOnce();

    vi.resetModules();
    configureServerAuth();
    const freshServerAuth = await import('@/lib/server-auth');
    nowSpy.mockRestore();
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(sessionNow);
    await expect(freshServerAuth.getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: deriveAuthSecretKid(activeSecret), exp: sessionNow + 1 }),
      activeSecret,
    )))).resolves.toMatchObject({ id: sessionUser.id });
    expect(nowSpy).toHaveBeenCalledOnce();
  });

  it('accepts the exact previous-session TTL boundary and rejects one millisecond beyond or future retirement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const boundaryRing = createSecretRing(sessionNow - sessionTtlSeconds * 1_000);
    configureServerAuth(boundaryRing);
    let serverAuth = await import('@/lib/server-auth');
    const boundaryToken = signSessionPayload({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
      kid: boundaryRing.previous?.kid,
    }, previousSecret);
    await expect(serverAuth.getSessionUser(
      requestWithSession(boundaryToken),
    )).resolves.toMatchObject({ id: sessionUser.id });

    const expiredRing = createSecretRing(sessionNow - sessionTtlSeconds * 1_000 - 1);
    serverAuthMocks.readDatabaseSecretRing.mockResolvedValue(expiredRing);
    const expiredWindowToken = signSessionPayload({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
      kid: expiredRing.previous?.kid,
    }, previousSecret);

    await expect(serverAuth.getSessionUser(
      requestWithSession(expiredWindowToken),
    )).resolves.toBeNull();

    vi.resetModules();
    const futureRing = createSecretRing(sessionNow + 1);
    configureServerAuth(futureRing);
    serverAuth = await import('@/lib/server-auth');
    const futureRetirementToken = signSessionPayload({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
      kid: futureRing.previous?.kid,
    }, previousSecret);
    await expect(serverAuth.getSessionUser(
      requestWithSession(futureRetirementToken),
    )).resolves.toBeNull();
  });

  it('fails closed for length-mismatched signatures and malformed payload fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    configureServerAuth();
    const { getSessionUser } = await import('@/lib/server-auth');
    const validPayload = {
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
      kid: deriveAuthSecretKid(activeSecret),
    };
    const encoded = Buffer.from(JSON.stringify(validPayload), 'utf8').toString('base64url');

    await expect(getSessionUser(requestWithSession(`${encoded}.x`))).resolves.toBeNull();
    await expect(getSessionUser(requestWithSession(
      `${encoded}.${'x'.repeat(1_024)}`,
    ))).resolves.toBeNull();

    const malformedPayloads: unknown[] = [
      [],
      { ...validPayload, sub: [sessionUser.id] },
      { ...validPayload, role: ['admin'] },
      { ...validPayload, name: { value: sessionUser.name } },
      { ...validPayload, exp: String(sessionNow + 60_000) },
      { ...validPayload, kid: [deriveAuthSecretKid(activeSecret)] },
    ];
    for (const payload of malformedPayloads) {
      await expect(getSessionUser(requestWithSession(
        signSessionPayload(payload, activeSecret),
      ))).resolves.toBeNull();
    }

    const prototypeFieldJson = JSON.stringify(validPayload).replace(
      /}$/,
      ',"__proto__":{"sub":"session-contract-user"}}',
    );
    const prototypeFieldEncoded = Buffer.from(prototypeFieldJson, 'utf8').toString('base64url');
    await expect(getSessionUser(requestWithSession(
      signEncodedPayload(prototypeFieldEncoded, activeSecret),
    ))).resolves.toBeNull();
  });

  it('returns a previous-session user without writing users, credentials, or secret files', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const ring = createSecretRing();
    configureServerAuth(ring);
    const { getSessionUser } = await import('@/lib/server-auth');
    const token = signSessionPayload({
      sub: sessionUser.id,
      role: sessionUser.role,
      name: sessionUser.name,
      exp: sessionNow + 60_000,
      kid: ring.previous?.kid,
    }, previousSecret);

    await expect(getSessionUser(requestWithSession(token))).resolves.toMatchObject({
      id: sessionUser.id,
    });
    expectNoSessionWrites();
  });

  it.each(['DB_ONLY', 'DB_PLUS_FILE'] as const)(
    'keeps active and previous session reads strictly read-only in %s',
    async mode => {
      vi.useFakeTimers();
      vi.setSystemTime(sessionNow);
      const ring = createSecretRing();
      configureServerAuth(ring, {
        mode,
        defaultAdminName: 'missing-default-administrator',
      });
      const { getSessionUser } = await import('@/lib/server-auth');

      await expect(getSessionUser(requestWithSession(signSessionPayload(
        sessionPayload({ kid: ring.active.kid }),
        activeSecret,
      )))).resolves.toMatchObject({ id: sessionUser.id });
      await expect(getSessionUser(requestWithSession(signSessionPayload(
        sessionPayload({ kid: ring.previous?.kid }),
        previousSecret,
      )))).resolves.toMatchObject({ id: sessionUser.id });

      expect(serverAuthMocks.readDatabaseSecretRing).toHaveBeenCalledTimes(2);
      expect(serverAuthMocks.resolveDatabaseSecretRing).not.toHaveBeenCalled();
      expectNoSessionWrites();
    },
  );

  it.each(['DB_ONLY', 'DB_PLUS_FILE'] as const)(
    'returns null for a missing persisted ring in %s without fallback or writes',
    async mode => {
      configureServerAuth(createSecretRing(), {
        mode,
        defaultAdminName: 'missing-default-administrator',
      });
      serverAuthMocks.readDatabaseSecretRing.mockResolvedValue(null);
      const { getSessionUser } = await import('@/lib/server-auth');

      await expect(getSessionUser(requestWithSession(signSessionPayload(
        sessionPayload({ kid: deriveAuthSecretKid(activeSecret) }),
        activeSecret,
      )))).resolves.toBeNull();

      expect(serverAuthMocks.dbReadUsers).not.toHaveBeenCalled();
      expectNoSessionWrites();
    },
  );

  it('reads FILE_ONLY active and previous sessions without bootstrapping or rewriting files', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(sessionNow);
    const ring = createSecretRing();
    const { ringPath, usersPath } = await configureFileSessionFixture({
      secretFile: JSON.stringify(ring),
    });
    const ringBefore = await readFile(ringPath, 'utf8');
    const usersBefore = await readFile(usersPath, 'utf8');
    const { getSessionUser } = await import('@/lib/server-auth');

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: ring.active.kid }),
      activeSecret,
    )))).resolves.toMatchObject({ id: sessionUser.id });
    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: ring.previous?.kid }),
      previousSecret,
    )))).resolves.toMatchObject({ id: sessionUser.id });

    await expect(readFile(ringPath, 'utf8')).resolves.toBe(ringBefore);
    await expect(readFile(usersPath, 'utf8')).resolves.toBe(usersBefore);
    expect(serverAuthMocks.resolveDatabaseSecretRing).not.toHaveBeenCalled();
    expectNoSessionWrites();
  });

  it('uses an environment secret with a legacy FILE_ONLY secret in memory without persisting rotation', async () => {
    const { ringPath, usersPath } = await configureFileSessionFixture({
      secretFile: previousSecret,
      configuredSecret: activeSecret,
    });
    const usersBefore = await readFile(usersPath, 'utf8');
    const { getSessionUser } = await import('@/lib/server-auth');

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: deriveAuthSecretKid(previousSecret) }),
      previousSecret,
    )))).resolves.toMatchObject({ id: sessionUser.id });

    await expect(readFile(ringPath, 'utf8')).resolves.toBe(previousSecret);
    await expect(readFile(usersPath, 'utf8')).resolves.toBe(usersBefore);
    expectNoSessionWrites();
  });

  it('uses a FILE_ONLY environment secret in memory when the ring file is missing', async () => {
    const { ringPath } = await configureFileSessionFixture({
      configuredSecret: activeSecret,
    });
    const { getSessionUser } = await import('@/lib/server-auth');

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: deriveAuthSecretKid(activeSecret) }),
      activeSecret,
    )))).resolves.toMatchObject({ id: sessionUser.id });

    await expect(readFile(ringPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expectNoSessionWrites();
  });

  it('fails closed for a damaged FILE_ONLY ring without changing users or secrets', async () => {
    const { ringPath, usersPath } = await configureFileSessionFixture({
      secretFile: '{"version":1,"active":',
    });
    const ringBefore = await readFile(ringPath, 'utf8');
    const usersBefore = await readFile(usersPath, 'utf8');
    const { getSessionUser } = await import('@/lib/server-auth');

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: deriveAuthSecretKid(activeSecret) }),
      activeSecret,
    )))).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION_UNAVAILABLE' });

    await expect(readFile(ringPath, 'utf8')).resolves.toBe(ringBefore);
    await expect(readFile(usersPath, 'utf8')).resolves.toBe(usersBefore);
    expectNoSessionWrites();
  });

  it('returns null for a missing FILE_ONLY user file without bootstrapping an administrator', async () => {
    const ring = createSecretRing();
    const { usersPath } = await configureFileSessionFixture({
      secretFile: JSON.stringify(ring),
      includeUsers: false,
    });
    const { getSessionUser } = await import('@/lib/server-auth');

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: ring.active.kid }),
      activeSecret,
    )))).resolves.toBeNull();
    await expect(readFile(usersPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expectNoSessionWrites();
  });

  it('does not let a read-only session ring populate the normal rotation cache', async () => {
    const readOnlyRing = createSecretRing();
    const nextActiveSecret = 'task-seven-next-active-session-secret-0123456789abc';
    const nextRing: AuthSecretRingV1 = {
      version: 1,
      active: {
        kid: deriveAuthSecretKid(nextActiveSecret),
        secret: nextActiveSecret,
        activatedAt: sessionNow,
      },
      previous: {
        ...readOnlyRing.active,
        retiredAt: sessionNow,
      },
      updatedAt: sessionNow,
    };
    configureServerAuth(readOnlyRing);
    serverAuthMocks.readDatabaseSecretRing.mockResolvedValue(readOnlyRing);
    serverAuthMocks.resolveDatabaseSecretRing.mockResolvedValue(nextRing);
    const { createSessionToken, getSessionUser } = await import('@/lib/server-auth');

    await expect(getSessionUser(requestWithSession(signSessionPayload(
      sessionPayload({ kid: readOnlyRing.active.kid }),
      activeSecret,
    )))).resolves.toMatchObject({ id: sessionUser.id });
    const newToken = await createSessionToken(sessionUser as User);
    const newPayload = JSON.parse(Buffer.from(newToken.split('.')[0], 'base64url').toString('utf8')) as {
      kid?: string;
    };

    expect(serverAuthMocks.readDatabaseSecretRing).toHaveBeenCalledOnce();
    expect(serverAuthMocks.resolveDatabaseSecretRing).toHaveBeenCalledOnce();
    expect(newPayload.kid).toBe(nextRing.active.kid);
  });

  it('keeps internal request authentication active-only after rotation', async () => {
    const ring = createSecretRing();
    configureServerAuth(ring);
    const { getAuthSecretForInternalRequests } = await import('@/lib/server-auth');

    await expect(getAuthSecretForInternalRequests()).resolves.toBe(activeSecret);
    await expect(getAuthSecretForInternalRequests()).resolves.not.toBe(previousSecret);
  });
});
