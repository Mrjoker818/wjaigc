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

function configurationUnavailable(): AuthServiceError {
  return new AuthServiceError(
    'AUTH_CONFIGURATION_UNAVAILABLE',
    'Authentication configuration is unavailable.',
    503,
    false,
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
       SET credential_hash = $2, updated_at = $3
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
