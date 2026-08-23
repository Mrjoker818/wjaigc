import { createHmac } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  getPool: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('@/lib/db-client', () => mocks);
vi.mock('server-only', () => ({}));

import {
  countLegacyCredentialUsers,
  readDatabaseSecretRing,
  readSystemSettingStrict,
  resolveDatabaseSecretRing,
  updateUserCredentials,
  updateUserCredentialSidecar,
  updateUserProfileFields,
} from '@/lib/auth/auth-repository';
import { deriveAuthSecretKid, type AuthSecretRingV1 } from '@/lib/auth/auth-secret-ring';
import {
  dbReadUsers,
  dbUpsertUser,
  dbWriteUsers,
  ensureCoreTables,
} from '@/lib/db-storage';

const now = 1_724_601_600_000;
const legacySecret = 'legacy-repository-secret-0123456789abcdef';
const configuredSecret = 'configured-repository-secret-0123456789abcdef';
const thirdSecret = 'third-repository-secret-0123456789abcdef12';
const credentialHash = [
  'scrypt-v1',
  '32768',
  '8',
  '1',
  Buffer.alloc(16, 1).toString('base64url'),
  Buffer.alloc(32, 2).toString('base64url'),
].join('$');

interface ControlledClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function useClient(query: ControlledClient['query']): ControlledClient {
  const client = { query, release: vi.fn() };
  mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
  return client;
}

function sqlCalls(client: ControlledClient): string[] {
  return client.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDatabaseConfigured.mockReturnValue(true);
  mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('strict authentication repository reads', () => {
  it.each(['DB_ONLY', 'DB_PLUS_FILE'] as const)(
    'keeps a legacy DB session valid in %s before the first post-upgrade login migrates the secret ring',
    async persistenceMode => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const ordinaryUserId = 'legacy-session-user';
    const query = vi.fn().mockResolvedValue({
      rows: [{ key: 'auth_secret', value: legacySecret }],
      rowCount: 1,
    });
    const client = useClient(query);
    mocks.execSql.mockResolvedValue({
      rows: [{
        id: ordinaryUserId,
        name: 'legacy-session-user-name',
        password_hash: 'unused-session-password-hash',
        credential_hash: null,
        role: 'user',
        status: 'active',
        product_type: null,
        group_id: null,
        chat_models: null,
        image_models: null,
        daily_token_limit: null,
        monthly_token_limit: null,
        daily_image_limit: null,
        avatar: null,
        nickname: null,
        api_permissions: {},
        storage_folder: `data/users/${ordinaryUserId}`,
        email: null,
        created_at: 1,
        updated_at: 1,
      }],
      rowCount: 1,
    });

    const originalEnvironment = { ...process.env };
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = persistenceMode;
    process.env.WUJIE_ADMIN_USERNAME = 'missing-default-administrator';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    vi.resetModules();

    try {
      const { getSessionUser, WUJIE_SESSION_COOKIE } = await import('@/lib/server-auth');
      const encoded = Buffer.from(JSON.stringify({
        sub: ordinaryUserId,
        role: 'user',
        name: 'legacy-session-user-name',
        exp: now + 60_000,
      }), 'utf8').toString('base64url');
      const signature = createHmac('sha256', legacySecret).update(encoded).digest('base64url');
      const request = {
        cookies: {
          get: (name: string) => name === WUJIE_SESSION_COOKIE
            ? { value: `${encoded}.${signature}` }
            : undefined,
        },
      } as unknown as NextRequest;

      await expect(getSessionUser(request)).resolves.toMatchObject({ id: ordinaryUserId });

      expect(client.query).toHaveBeenCalledOnce();
      expect(sqlCalls(client)).toEqual([
        'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[])',
      ]);
      expect(client.query).toHaveBeenCalledWith(
        expect.any(String),
        [['auth_secret_ring_v1', 'auth_secret']],
      );
      expect(sqlCalls(client).join(' ')).not.toMatch(/BEGIN|FOR UPDATE|INSERT|UPDATE|COMMIT/);
      expect(mocks.execSql).toHaveBeenCalledOnce();
      expect(client.release).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnvironment)) delete process.env[key];
      }
      Object.assign(process.env, originalEnvironment);
    }
    },
  );

  it('keeps reachable active and previous DB session reads on the real read-only repository path', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const previousSecret = 'previous-reachable-session-secret-0123456789abcdef';
    const ordinaryUserId = 'ordinary-session-user';
    const ring: AuthSecretRingV1 = {
      version: 1,
      active: {
        kid: deriveAuthSecretKid(configuredSecret),
        secret: configuredSecret,
        activatedAt: now - 1_000,
      },
      previous: {
        kid: deriveAuthSecretKid(previousSecret),
        secret: previousSecret,
        activatedAt: now - 2_000,
        retiredAt: now - 1_000,
      },
      updatedAt: now - 1_000,
    };
    const query = vi.fn().mockResolvedValue({
      rows: [{ key: 'auth_secret_ring_v1', value: ring }],
      rowCount: 1,
    });
    const client = useClient(query);
    mocks.execSql.mockResolvedValue({
      rows: [{
        id: ordinaryUserId,
        name: 'ordinary-session-user-name',
        password_hash: 'unused-session-password-hash',
        credential_hash: null,
        role: 'user',
        status: 'active',
        product_type: null,
        group_id: null,
        chat_models: null,
        image_models: null,
        daily_token_limit: null,
        monthly_token_limit: null,
        daily_image_limit: null,
        avatar: null,
        nickname: null,
        api_permissions: {},
        storage_folder: `data/users/${ordinaryUserId}`,
        email: null,
        created_at: 1,
        updated_at: 1,
      }],
      rowCount: 1,
    });

    const originalEnvironment = { ...process.env };
    process.env.COZE_PROJECT_ENV = 'DEV';
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
    process.env.WUJIE_ADMIN_USERNAME = 'missing-default-administrator';
    delete process.env.WUJIE_AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    vi.resetModules();

    try {
      const { getSessionUser, WUJIE_SESSION_COOKIE } = await import('@/lib/server-auth');
      const request = (secret: string, kid: string): NextRequest => {
        const encoded = Buffer.from(JSON.stringify({
          sub: ordinaryUserId,
          role: 'user',
          name: 'ordinary-session-user-name',
          exp: now + 60_000,
          kid,
        }), 'utf8').toString('base64url');
        const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
        return {
          cookies: {
            get: (name: string) => name === WUJIE_SESSION_COOKIE
              ? { value: `${encoded}.${signature}` }
              : undefined,
          },
        } as unknown as NextRequest;
      };

      await expect(getSessionUser(request(
        configuredSecret,
        ring.active.kid,
      ))).resolves.toMatchObject({ id: ordinaryUserId });
      await expect(getSessionUser(request(
        previousSecret,
        ring.previous?.kid ?? '',
      ))).resolves.toMatchObject({ id: ordinaryUserId });

      expect(sqlCalls(client)).toEqual([
        'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[])',
        'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[])',
      ]);
      expect(mocks.execSql).toHaveBeenCalledTimes(2);
      expect(mocks.execSql).toHaveBeenCalledWith(
        'SELECT * FROM wujie_users ORDER BY created_at ASC',
      );
      expect(sqlCalls(client).join(' ')).not.toMatch(/BEGIN|FOR UPDATE|INSERT|UPDATE|COMMIT/);
    } finally {
      vi.useRealTimers();
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnvironment)) delete process.env[key];
      }
      Object.assign(process.env, originalEnvironment);
    }
  });

  it('reads a persisted secret ring without locks, rotation, or writes', async () => {
    const ring: AuthSecretRingV1 = {
      version: 1,
      active: {
        kid: deriveAuthSecretKid(configuredSecret),
        secret: configuredSecret,
        activatedAt: now,
      },
      updatedAt: now,
    };
    const query = vi.fn().mockResolvedValue({
      rows: [{ key: 'auth_secret_ring_v1', value: ring }],
      rowCount: 1,
    });
    const client = useClient(query);
    await expect(readDatabaseSecretRing()).resolves.toEqual(ring);

    expect(sqlCalls(client)).toEqual([
      'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[])',
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.any(String),
      [['auth_secret_ring_v1', 'auth_secret']],
    );
    expect(sqlCalls(client).join(' ')).not.toMatch(/BEGIN|FOR UPDATE|INSERT|UPDATE|COMMIT/);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns null for a missing read-only ring and rejects malformed persisted data', async () => {
    let client = useClient(vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }));
    await expect(readDatabaseSecretRing()).resolves.toBeNull();
    expect(client.release).toHaveBeenCalledOnce();

    client = useClient(vi.fn().mockResolvedValue({
      rows: [{
        key: 'auth_secret_ring_v1',
        value: { version: 1, active: null, updatedAt: now },
      }],
      rowCount: 1,
    }));
    await expect(readDatabaseSecretRing()).rejects.toMatchObject({
      code: 'AUTH_CONFIGURATION_UNAVAILABLE',
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('uses the caller timestamp when adapting a legacy secret into a read-only ring', async () => {
    const client = useClient(vi.fn().mockResolvedValue({
      rows: [{ key: 'auth_secret', value: legacySecret }],
      rowCount: 1,
    }));

    await expect(readDatabaseSecretRing(now)).resolves.toMatchObject({
      active: { activatedAt: now },
      updatedAt: now,
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('prefers a persisted ring when the same snapshot also contains a different legacy secret', async () => {
    const ring: AuthSecretRingV1 = {
      version: 1,
      active: {
        kid: deriveAuthSecretKid(configuredSecret),
        secret: configuredSecret,
        activatedAt: now - 1,
      },
      updatedAt: now - 1,
    };
    const client = useClient(vi.fn().mockResolvedValue({
      rows: [
        { key: 'auth_secret', value: legacySecret },
        { key: 'auth_secret_ring_v1', value: ring },
      ],
      rowCount: 2,
    }));

    await expect(readDatabaseSecretRing(now)).resolves.toEqual(ring);
    expect(client.query).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('distinguishes a missing setting from a stored JSON value', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ value: false }], rowCount: 1 });
    const client = useClient(query);

    await expect(readSystemSettingStrict('missing')).resolves.toEqual({ found: false });
    await expect(readSystemSettingStrict('stored-false')).resolves.toEqual({
      found: true,
      value: false,
    });

    expect(mocks.execSql).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it('wraps connection and query failures without logging keys or database details', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
    ];
    const query = vi.fn().mockRejectedValue(
      new Error('postgresql://secret-user:secret-password@example.test/private'),
    );
    const client = useClient(query);

    await expect(readSystemSettingStrict('secret-setting-key')).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });

    expect(client.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleSpies.flatMap(spy => spy.mock.calls))).not.toContain('secret');
    consoleSpies.forEach(spy => spy.mockRestore());
  });
});

describe('transactional authentication secret ring resolution', () => {
  it('locks, preserves the legacy verifier, upserts one JSON ring, and commits in order', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT key, value')) {
        return { rows: [{ key: 'auth_secret', value: legacySecret }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);

    const ring = await resolveDatabaseSecretRing({ configuredSecret, now });

    expect(ring).toEqual({
      version: 1,
      active: {
        kid: deriveAuthSecretKid(configuredSecret),
        secret: configuredSecret,
        activatedAt: now,
      },
      previous: {
        kid: deriveAuthSecretKid(legacySecret),
        secret: legacySecret,
        activatedAt: now,
        retiredAt: now,
      },
      updatedAt: now,
    });
    expect(sqlCalls(client)).toEqual([
      'BEGIN',
      "SELECT pg_advisory_xact_lock(hashtext('wujie:auth-secret-ring:v1'))",
      'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[]) FOR UPDATE',
      expect.stringContaining('INSERT INTO wujie_system_settings'),
      'COMMIT',
    ]);
    const upserts = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO'));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.[1]?.[1]).toBe(JSON.stringify(ring));
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('counts legacy credentials on the same client before blocking a second rotation', async () => {
    const existingRing = {
      version: 1 as const,
      active: {
        kid: deriveAuthSecretKid(configuredSecret),
        secret: configuredSecret,
        activatedAt: now - 1,
      },
      previous: {
        kid: deriveAuthSecretKid(legacySecret),
        secret: legacySecret,
        activatedAt: now - 2,
        retiredAt: now - 1,
      },
      updatedAt: now - 1,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT key, value')) {
        return {
          rows: [{ key: 'auth_secret_ring_v1', value: existingRing }],
          rowCount: 1,
        };
      }
      if (sql.includes('count(*)')) {
        return { rows: [{ count: '1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);

    await expect(resolveDatabaseSecretRing({
      configuredSecret: thirdSecret,
      now,
    })).rejects.toMatchObject({ code: 'AUTH_ROTATION_BLOCKED_LEGACY_CREDENTIALS' });

    expect(sqlCalls(client)).toEqual([
      'BEGIN',
      "SELECT pg_advisory_xact_lock(hashtext('wujie:auth-secret-ring:v1'))",
      'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[]) FOR UPDATE',
      expect.stringContaining('SELECT count(*)::text AS count FROM wujie_users'),
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('fails closed without generating or persisting a secret when no valid source exists', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = useClient(query);

    await expect(resolveDatabaseSecretRing({ configuredSecret: null, now })).rejects.toMatchObject({
      code: 'AUTH_CONFIGURATION_UNAVAILABLE',
      retryable: true,
    });

    expect(sqlCalls(client)).toEqual([
      'BEGIN',
      "SELECT pg_advisory_xact_lock(hashtext('wujie:auth-secret-ring:v1'))",
      'SELECT key, value FROM wujie_system_settings WHERE key = ANY($1::text[]) FOR UPDATE',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back before release and wraps an upsert failure without leaking secrets', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT key, value')) {
        return { rows: [{ key: 'auth_secret', value: legacySecret }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO')) {
        throw new Error(`write failed for ${configuredSecret}`);
      }
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(resolveDatabaseSecretRing({ configuredSecret, now })).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });

    expect(sqlCalls(client).at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('evicts the client when rollback fails without replacing the sanitized operation error', async () => {
    const operationError = new Error(`operation failed for ${configuredSecret}`);
    const rollbackError = new Error('rollback transport exposed private database details');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT key, value')) {
        return { rows: [{ key: 'auth_secret', value: legacySecret }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO')) throw operationError;
      if (sql === 'ROLLBACK') throw rollbackError;
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);

    let caught: unknown;
    try {
      await resolveDatabaseSecretRing({ configuredSecret, now });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
      message: 'Authentication persistence is unavailable.',
    });
    expect(String((caught as Error).message)).not.toContain('rollback transport');
    expect(String((caught as Error).message)).not.toContain(configuredSecret);
    expect(client.release.mock.calls).toEqual([[rollbackError]]);
    expect(sqlCalls(client).at(-1)).toBe('ROLLBACK');
  });
});

describe('credential sidecar repository', () => {
  it('validates the credential before connecting', async () => {
    await expect(updateUserCredentialSidecar('user-secret', 'not-a-credential')).rejects.toMatchObject({
      code: 'AUTH_CREDENTIAL_FORMAT_INVALID',
    });
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it.each([
    [{ rows: [{ id: 'user-1' }], rowCount: 1 }, undefined, 'updated'],
    [{ rows: [], rowCount: 0 }, { rows: [{ exists: true }], rowCount: 1 }, 'already-set'],
    [{ rows: [], rowCount: 0 }, { rows: [{ exists: false }], rowCount: 1 }, 'user-missing'],
  ] as const)('returns a narrow non-disclosing %s status', async (updateResult, existsResult, status) => {
    const query = existsResult
      ? vi.fn().mockResolvedValueOnce(updateResult).mockResolvedValueOnce(existsResult)
      : vi.fn().mockResolvedValueOnce(updateResult);
    const client = useClient(query);

    await expect(updateUserCredentialSidecar('user-1', credentialHash)).resolves.toBe(status);

    expect(sqlCalls(client)[0]).toContain('WHERE id = $1 AND credential_hash IS NULL RETURNING id');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('wraps sidecar write failures and does not log the user or credential', async () => {
    const client = useClient(vi.fn().mockRejectedValue(new Error('synthetic write failure')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(updateUserCredentialSidecar('sensitive-user', credentialHash)).rejects.toMatchObject({
      code: 'AUTH_PERSISTENCE_UNAVAILABLE',
    });

    expect(client.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive-user');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(credentialHash);
    consoleError.mockRestore();
  });

  it('counts every non-empty legacy password with a null sidecar', async () => {
    const client = useClient(vi.fn().mockResolvedValue({ rows: [{ count: '7' }], rowCount: 1 }));

    await expect(countLegacyCredentialUsers()).resolves.toBe(7);

    expect(sqlCalls(client)).toEqual([
      expect.stringContaining("credential_hash IS NULL AND btrim(password_hash) <> ''"),
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('atomic managed-user repository updates', () => {
  const profile = {
    name: 'User One',
    role: 'user' as const,
    status: 'active' as const,
    productType: 'canvas,chat',
    groupId: null,
    chatModels: ['chat-model'],
    imageModels: ['image-model'],
    dailyTokenLimit: 10,
    monthlyTokenLimit: 20,
    dailyImageLimit: 30,
    avatar: null,
    nickname: 'One',
    apiPermissions: { image: true, chat: false },
    storageFolder: 'data/users/user-1',
    email: 'user-1@example.test',
  };

  it('updates only non-credential fields with an updated_at CAS', async () => {
    const client = useClient(vi.fn().mockResolvedValue({
      rows: [{ id: 'user-1' }],
      rowCount: 1,
    }));

    await expect(updateUserProfileFields({
      userId: 'user-1',
      expectedUpdatedAt: now,
      updatedAt: now + 1,
      profile,
    })).resolves.toBe('updated');

    const sql = sqlCalls(client)[0] || '';
    expect(sql).toContain('WHERE id = $1 AND updated_at = $2 RETURNING id');
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('credential_hash');
    expect(client.query.mock.calls[0]?.[1]).toEqual([
      'user-1',
      now,
      profile.name,
      profile.role,
      profile.status,
      profile.productType,
      profile.groupId,
      profile.chatModels,
      profile.imageModels,
      profile.dailyTokenLimit,
      profile.monthlyTokenLimit,
      profile.dailyImageLimit,
      profile.avatar,
      profile.nickname,
      JSON.stringify(profile.apiPermissions),
      profile.storageFolder,
      profile.email,
      now + 1,
    ]);
  });

  it('atomically writes both credentials with password and version CAS conditions', async () => {
    const client = useClient(vi.fn().mockResolvedValue({
      rows: [{ id: 'user-1' }],
      rowCount: 1,
    }));
    const passwordHash = 'a'.repeat(64);

    await expect(updateUserCredentials({
      userId: 'user-1',
      expectedUpdatedAt: now,
      expectedPasswordHash: 'b'.repeat(64),
      passwordHash,
      credentialHash,
      updatedAt: now + 1,
      profile,
    })).resolves.toBe('updated');

    const sql = sqlCalls(client)[0] || '';
    expect(sql).toContain('password_hash = $3');
    expect(sql).toContain('credential_hash = $4');
    expect(sql).toContain(
      'WHERE id = $1 AND updated_at = $2 AND password_hash = $5 RETURNING id',
    );
    expect(client.query.mock.calls[0]?.[1]?.slice(0, 5)).toEqual([
      'user-1',
      now,
      passwordHash,
      credentialHash,
      'b'.repeat(64),
    ]);
  });

  it.each([
    [{ rows: [], rowCount: 0 }, { rows: [{ exists: true }], rowCount: 1 }, 'conflict'],
    [{ rows: [], rowCount: 0 }, { rows: [{ exists: false }], rowCount: 1 }, 'user-missing'],
  ] as const)('distinguishes a CAS conflict from a missing user', async (
    updateResult,
    existsResult,
    expected,
  ) => {
    useClient(vi.fn()
      .mockResolvedValueOnce(updateResult)
      .mockResolvedValueOnce(existsResult));

    await expect(updateUserProfileFields({
      userId: 'user-1',
      expectedUpdatedAt: now,
      updatedAt: now + 1,
      profile,
    })).resolves.toBe(expected);
  });
});

describe('database credential sidecar mappings', () => {
  it('adds the nullable sidecar to fresh schemas and additive initialization', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await ensureCoreTables();
    consoleLog.mockRestore();

    const statements = mocks.execSql.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
    const createUsers = statements.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS wujie_users'));
    expect(createUsers).toContain('credential_hash TEXT');
    expect(statements).toContain(
      'ALTER TABLE wujie_users ADD COLUMN IF NOT EXISTS credential_hash TEXT DEFAULT NULL',
    );
  });

  it('maps null sidecars on reads and preserves an existing sidecar when a caller omits it', async () => {
    mocks.execSql.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        name: 'User',
        password_hash: 'legacy',
        credential_hash: null,
        role: 'user',
        status: 'active',
        api_permissions: {},
        storage_folder: 'users/user-1',
        created_at: now,
        updated_at: now,
      }],
      rowCount: 1,
    });
    await expect(dbReadUsers()).resolves.toEqual([
      expect.objectContaining({ credential_hash: null }),
    ]);

    mocks.execSql.mockClear();
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 1 });
    await expect(dbWriteUsers([{
      id: 'user-1',
      name: 'User',
      passwordHash: 'legacy',
      role: 'user',
      status: 'active',
      apiPermissions: {},
      storageFolder: 'users/user-1',
      createdAt: now,
      updatedAt: now,
    }])).resolves.toBe(true);

    const [sql, params] = mocks.execSql.mock.calls[0] ?? [];
    expect(String(sql).replace(/\s+/g, ' ')).toContain(
      'credential_hash = COALESCE(EXCLUDED.credential_hash, wujie_users.credential_hash)',
    );
    expect(params).toContain(null);
  });

  it('normalizes PostgreSQL BIGINT user timestamps from strings at the database boundary', async () => {
    mocks.execSql.mockResolvedValueOnce({
      rows: [{
        id: 'string-timestamp-user',
        name: 'String Timestamp User',
        password_hash: 'legacy',
        credential_hash: null,
        role: 'user',
        status: 'active',
        api_permissions: {},
        storage_folder: 'users/string-timestamp-user',
        created_at: '1724601600000',
        updated_at: '1724601600001',
      }],
      rowCount: 1,
    });

    await expect(dbReadUsers()).resolves.toEqual([
      expect.objectContaining({
        created_at: 1_724_601_600_000,
        updated_at: 1_724_601_600_001,
      }),
    ]);
  });

  it.each([
    ['not-an-integer', '1724601600000.5'],
    ['outside the safe integer range', '9007199254740992'],
  ])('fails closed when a PostgreSQL BIGINT timestamp is %s', async (_label, updatedAt) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.execSql.mockResolvedValueOnce({
      rows: [{
        id: 'invalid-timestamp-user',
        name: 'Invalid Timestamp User',
        password_hash: 'legacy',
        credential_hash: null,
        role: 'user',
        status: 'active',
        api_permissions: {},
        storage_folder: 'users/invalid-timestamp-user',
        created_at: '1724601600000',
        updated_at: updatedAt,
      }],
      rowCount: 1,
    });

    await expect(dbReadUsers()).rejects.toThrow('Invalid database user timestamp');
    expect(consoleError).toHaveBeenCalledWith({ code: 'DB_READ_USERS_FAILED' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(updatedAt);
  });

  it('passes an omitted dbUpsertUser sidecar as null into the preserving COALESCE contract', async () => {
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 1 });
    const userWithoutSidecar: Parameters<typeof dbUpsertUser>[0] = {
      id: 'legacy-upsert-user',
      name: 'Legacy Upsert User',
      password_hash: 'legacy-password-hash',
      role: 'user',
      status: 'active',
      api_permissions: { image: true },
      storage_folder: 'users/legacy-upsert-user',
      created_at: now,
      updated_at: now + 1,
    };

    await expect(dbUpsertUser(userWithoutSidecar)).resolves.toBe(true);

    const [sql, params] = mocks.execSql.mock.calls.at(-1) ?? [];
    expect(String(sql).replace(/\s+/g, ' ')).toContain(
      'credential_hash = COALESCE(EXCLUDED.credential_hash, wujie_users.credential_hash)',
    );
    expect(params?.[3]).toBeNull();
  });

  it('does not log database errors containing user or credential material', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const privateError = new Error(
      'postgresql://private-user:private-password@example.test hash=scrypt-secret',
    );
    mocks.execSql.mockRejectedValue(privateError);

    await expect(dbReadUsers()).rejects.toBe(privateError);
    await expect(dbWriteUsers([{
      id: 'private-user',
      name: 'private-name',
      passwordHash: 'private-password-hash',
      credentialHash,
      role: 'user',
      status: 'active',
      apiPermissions: {},
      storageFolder: 'users/private-user',
      createdAt: now,
      updatedAt: now,
    }])).resolves.toBe(false);

    expect(consoleError.mock.calls).toEqual([
      [{ code: 'DB_READ_USERS_FAILED' }],
      [{ code: 'DB_WRITE_USERS_FAILED' }],
    ]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('scrypt');
  });
});
