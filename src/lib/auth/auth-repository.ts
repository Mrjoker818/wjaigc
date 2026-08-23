import type { PoolClient } from 'pg';

import { getPool } from '../db-client';
import { AuthServiceError } from './auth-errors';
import { isValidScryptCredential } from './auth-password';
import {
  deriveAuthSecretKid,
  parseAuthSecretRing,
  planSecretRingRotation,
  type AuthSecretRingV1,
} from './auth-secret-ring';

const AUTH_SECRET_RING_KEY = 'auth_secret_ring_v1';
const LEGACY_AUTH_SECRET_KEY = 'auth_secret';
const MIN_SECRET_LENGTH = 32;

export type StrictSettingRead = { found: false } | { found: true; value: unknown };
export type CredentialSidecarUpdateStatus = 'updated' | 'already-set' | 'user-missing';
export type AtomicUserUpdateStatus = 'updated' | 'conflict' | 'user-missing';

const AUTH_FILE_REPLICA_LOCK_KEY = 'wujie:auth-file-replica:v1';

export interface AuthUserProfileFields {
  name: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  productType: string | null;
  groupId: string | null;
  chatModels: string[] | null;
  imageModels: string[] | null;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyImageLimit: number | null;
  avatar: string | null;
  nickname: string | null;
  apiPermissions: Record<string, boolean>;
  storageFolder: string;
  email: string | null;
}

function configurationUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_CONFIGURATION_UNAVAILABLE',
    'Authentication configuration is unavailable.',
    503,
    true,
  );
}

function persistenceUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_PERSISTENCE_UNAVAILABLE',
    'Authentication persistence is unavailable.',
    503,
    true,
  );
}

function credentialFormatInvalid(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_CREDENTIAL_FORMAT_INVALID',
    'Authentication credential format is invalid.',
    409,
    false,
  );
}

function wrapPersistenceError(error: unknown): AuthServiceError {
  return error instanceof AuthServiceError ? error : persistenceUnavailable();
}

export async function withDatabaseAuthReplicaLock<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [AUTH_FILE_REPLICA_LOCK_KEY]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original replica failure.
    }
    throw wrapPersistenceError(error);
  } finally {
    client.release();
  }
}

function isValidSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

function isValidTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function createInitialRing(secret: string, now: number): AuthSecretRingV1 {
  if (!isValidSecret(secret) || !isValidTimestamp(now)) {
    throw configurationUnavailable();
  }

  return {
    version: 1,
    active: {
      kid: deriveAuthSecretKid(secret),
      secret,
      activatedAt: now,
    },
    updatedAt: now,
  };
}

async function countLegacyCredentialUsersWithClient(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM wujie_users
    WHERE credential_hash IS NULL
      AND btrim(password_hash) <> ''
  `);
  const count = Number(result.rows[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid legacy credential count.');
  }
  return count;
}

export async function readSystemSettingStrict(key: string): Promise<StrictSettingRead> {
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    const result = await client.query<{ value: unknown }>(
      'SELECT value FROM wujie_system_settings WHERE key = $1',
      [key],
    );
    if (result.rows.length === 0) {
      return { found: false };
    }
    return { found: true, value: result.rows[0]?.value };
  } catch (error) {
    throw wrapPersistenceError(error);
  } finally {
    client?.release();
  }
}

export async function readDatabaseSecretRing(): Promise<AuthSecretRingV1 | null> {
  const setting = await readSystemSettingStrict(AUTH_SECRET_RING_KEY);
  if (!setting.found) return null;

  const ring = parseAuthSecretRing(setting.value);
  if (!ring) throw configurationUnavailable();
  return ring;
}

export async function resolveDatabaseSecretRing(input: {
  configuredSecret: string | null;
  now: number;
}): Promise<AuthSecretRingV1> {
  let client: PoolClient | undefined;
  let clientReleased = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('wujie:auth-secret-ring:v1'))",
    );
    const settings = await client.query<{ key: string; value: unknown }>(
      `SELECT key, value
       FROM wujie_system_settings
       WHERE key = ANY($1::text[])
       FOR UPDATE`,
      [[AUTH_SECRET_RING_KEY, LEGACY_AUTH_SECRET_KEY]],
    );
    const values = new Map(settings.rows.map(row => [row.key, row.value]));
    const existingRing = parseAuthSecretRing(values.get(AUTH_SECRET_RING_KEY));
    const legacySecretValue = values.get(LEGACY_AUTH_SECRET_KEY);
    const legacySecret = isValidSecret(legacySecretValue) ? legacySecretValue : null;

    if (input.configuredSecret !== null && !isValidSecret(input.configuredSecret)) {
      throw configurationUnavailable();
    }
    if (!isValidTimestamp(input.now)) {
      throw configurationUnavailable();
    }

    let ring: AuthSecretRingV1;
    if (existingRing) {
      ring = existingRing;
      if (input.configuredSecret && input.configuredSecret !== ring.active.secret) {
        const previousNeeded = ring.previous
          ? await countLegacyCredentialUsersWithClient(client) > 0
          : false;
        ring = planSecretRingRotation(
          ring,
          input.configuredSecret,
          input.now,
          previousNeeded,
        );
      }
    } else {
      const initialSecret = legacySecret ?? input.configuredSecret;
      if (!initialSecret) {
        throw configurationUnavailable();
      }
      ring = createInitialRing(initialSecret, input.now);
      if (input.configuredSecret && input.configuredSecret !== initialSecret) {
        ring = planSecretRingRotation(ring, input.configuredSecret, input.now, false);
      }
    }

    await client.query(
      `INSERT INTO wujie_system_settings(key, value, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at`,
      [AUTH_SECRET_RING_KEY, JSON.stringify(ring), input.now],
    );
    await client.query('COMMIT');
    return ring;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        const releaseError = rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError));
        try {
          client.release(releaseError);
        } catch {
          // Preserve the sanitized repository operation error.
        }
        clientReleased = true;
      }
    }
    throw wrapPersistenceError(error);
  } finally {
    if (client && !clientReleased) client.release();
  }
}

export async function updateUserCredentialSidecar(
  userId: string,
  credentialHash: string,
): Promise<CredentialSidecarUpdateStatus> {
  if (!isValidScryptCredential(credentialHash)) {
    throw credentialFormatInvalid();
  }

  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    const updated = await client.query<{ id: string }>(
      `UPDATE wujie_users
       SET credential_hash = $2, updated_at = GREATEST(updated_at + 1, $3)
       WHERE id = $1 AND credential_hash IS NULL
       RETURNING id`,
      [userId, credentialHash, Date.now()],
    );
    if (updated.rows.length > 0) {
      return 'updated';
    }

    const existing = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM wujie_users WHERE id = $1) AS exists',
      [userId],
    );
    return existing.rows[0]?.exists === true ? 'already-set' : 'user-missing';
  } catch (error) {
    throw wrapPersistenceError(error);
  } finally {
    client?.release();
  }
}

async function atomicUpdateStatus(
  client: PoolClient,
  userId: string,
  updatedRows: number,
): Promise<AtomicUserUpdateStatus> {
  if (updatedRows > 0) return 'updated';
  const existing = await client.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM wujie_users WHERE id = $1) AS exists',
    [userId],
  );
  return existing.rows[0]?.exists === true ? 'conflict' : 'user-missing';
}

function profileParameters(profile: AuthUserProfileFields): unknown[] {
  return [
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
  ];
}

export async function updateUserProfileFields(input: {
  userId: string;
  expectedUpdatedAt: number;
  updatedAt: number;
  profile: AuthUserProfileFields;
}): Promise<AtomicUserUpdateStatus> {
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    const updated = await client.query<{ id: string }>(
      `UPDATE wujie_users
       SET name = $3,
           role = $4,
           status = $5,
           product_type = $6,
           group_id = $7,
           chat_models = $8,
           image_models = $9,
           daily_token_limit = $10,
           monthly_token_limit = $11,
           daily_image_limit = $12,
           avatar = $13,
           nickname = $14,
           api_permissions = $15,
           storage_folder = $16,
           email = $17,
           updated_at = $18
       WHERE id = $1 AND updated_at = $2
       RETURNING id`,
      [
        input.userId,
        input.expectedUpdatedAt,
        ...profileParameters(input.profile),
        input.updatedAt,
      ],
    );
    return await atomicUpdateStatus(client, input.userId, updated.rows.length);
  } catch (error) {
    throw wrapPersistenceError(error);
  } finally {
    client?.release();
  }
}

export async function updateUserCredentials(input: {
  userId: string;
  expectedUpdatedAt: number;
  expectedPasswordHash: string;
  passwordHash: string;
  credentialHash: string;
  updatedAt: number;
  profile: AuthUserProfileFields;
}): Promise<AtomicUserUpdateStatus> {
  if (!isValidScryptCredential(input.credentialHash)) {
    throw credentialFormatInvalid();
  }

  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    const updated = await client.query<{ id: string }>(
      `UPDATE wujie_users
       SET password_hash = $3,
           credential_hash = $4,
           name = $6,
           role = $7,
           status = $8,
           product_type = $9,
           group_id = $10,
           chat_models = $11,
           image_models = $12,
           daily_token_limit = $13,
           monthly_token_limit = $14,
           daily_image_limit = $15,
           avatar = $16,
           nickname = $17,
           api_permissions = $18,
           storage_folder = $19,
           email = $20,
           updated_at = $21
       WHERE id = $1 AND updated_at = $2 AND password_hash = $5
       RETURNING id`,
      [
        input.userId,
        input.expectedUpdatedAt,
        input.passwordHash,
        input.credentialHash,
        input.expectedPasswordHash,
        ...profileParameters(input.profile),
        input.updatedAt,
      ],
    );
    return await atomicUpdateStatus(client, input.userId, updated.rows.length);
  } catch (error) {
    throw wrapPersistenceError(error);
  } finally {
    client?.release();
  }
}

export async function countLegacyCredentialUsers(): Promise<number> {
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    return await countLegacyCredentialUsersWithClient(client);
  } catch (error) {
    throw wrapPersistenceError(error);
  } finally {
    client?.release();
  }
}
