import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { execSql } from '@/lib/db-client';
import { GatewayError, type GatewayKeyRecord } from '@/lib/media-gateway/types';

export interface GatewayKeyView {
  id: string;
  userId: string;
  keyPrefix: string;
  label: string;
  requestsPerMinute: number;
  dailyQuota: number;
  todayUsage: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface GatewayPrincipal {
  keyId: string;
  userId: string;
  requestsPerMinute: number;
  dailyQuota: number;
}

export interface IssueGatewayKeyInput {
  userId: string;
  label: string;
  requestsPerMinute: number;
  dailyQuota: number;
  createdBy: string;
}

export interface UpdateGatewayKeyInput {
  label?: string;
  requestsPerMinute?: number;
  dailyQuota?: number;
  enabled?: boolean;
}

type GatewayKeyRow = {
  id: string;
  user_id: string;
  key_prefix: string;
  label: string;
  requests_per_minute: number;
  daily_quota: number;
  enabled: boolean;
  created_by: string;
  created_at: string | Date;
  last_used_at: string | Date | null;
  revoked_at: string | Date | null;
  today_usage?: unknown;
};

const PUBLIC_COLUMNS = `
  id, user_id, key_prefix, label, requests_per_minute, daily_quota,
  enabled, created_by, created_at, last_used_at, revoked_at
`;
const SECRET_PATTERN = /^wmg_[A-Za-z0-9_-]{43,}$/;

function invalidRequest(message = 'Invalid gateway key request', status = 400): GatewayError {
  return new GatewayError('GATEWAY_INVALID_REQUEST', status, message);
}

function invalidKey(): GatewayError {
  return new GatewayError('GATEWAY_KEY_INVALID', 401, 'Gateway key is invalid');
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function toView(row: GatewayKeyRow): GatewayKeyView {
  if (!Number.isSafeInteger(row.today_usage) || Number(row.today_usage) < 0) {
    throw new GatewayError(
      'GATEWAY_INTERNAL_UNAVAILABLE',
      503,
      'Gateway key usage is unavailable',
      true,
    );
  }
  return {
    id: row.id,
    userId: row.user_id,
    keyPrefix: row.key_prefix,
    label: row.label,
    requestsPerMinute: row.requests_per_minute,
    dailyQuota: row.daily_quota,
    todayUsage: Number(row.today_usage),
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    lastUsedAt: nullableIso(row.last_used_at),
    revokedAt: nullableIso(row.revoked_at),
  };
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function validRequestsPerMinute(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 600;
}

function validDailyQuota(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100_000;
}

function validateIssueInput(input: IssueGatewayKeyInput): void {
  if (
    !isBoundedText(input.userId, 200)
    || !isBoundedText(input.createdBy, 200)
    || !isBoundedText(input.label, 100)
    || !validRequestsPerMinute(input.requestsPerMinute)
    || !validDailyQuota(input.dailyQuota)
  ) {
    throw invalidRequest();
  }
}

function validateKeyId(keyId: string): void {
  if (!isBoundedText(keyId, 100) || !keyId.startsWith('gwkey_')) throw invalidRequest();
}

export async function issueGatewayKey(
  input: IssueGatewayKeyInput,
): Promise<{ key: GatewayKeyView; secret: string }> {
  validateIssueInput(input);
  const user = await execSql('SELECT id FROM wujie_users WHERE id = $1 LIMIT 1', [input.userId]);
  if (user.rowCount !== 1) throw invalidRequest('Gateway key user was not found', 404);

  const secret = `wmg_${randomBytes(32).toString('base64url')}`;
  const keyHash = createHash('sha256').update(secret).digest('hex');
  const id = `gwkey_${randomUUID()}`;
  const result = await execSql(
    `INSERT INTO wujie_gateway_keys (
       id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${PUBLIC_COLUMNS}, 0::integer AS today_usage`,
    [
      id,
      input.userId,
      keyHash,
      secret.slice(0, 12),
      input.label.trim(),
      input.requestsPerMinute,
      input.dailyQuota,
      input.createdBy,
    ],
  );
  const row = result.rows[0] as GatewayKeyRow | undefined;
  if (!row) throw new GatewayError('GATEWAY_INTERNAL_UNAVAILABLE', 503, 'Gateway key storage is unavailable', true);
  return { key: toView(row), secret };
}

export async function authenticateGatewayBearer(value: string | null): Promise<GatewayPrincipal> {
  const match = typeof value === 'string' ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null;
  const secret = match?.[1] ?? '';
  if (!SECRET_PATTERN.test(secret)) throw invalidKey();

  const digest = createHash('sha256').update(secret).digest('hex');
  const result = await execSql(
    `UPDATE wujie_gateway_keys
        SET last_used_at = now()
      WHERE key_hash = $1 AND enabled = TRUE AND revoked_at IS NULL
      RETURNING ${PUBLIC_COLUMNS}`,
    [digest],
  );
  const row = result.rows[0] as GatewayKeyRow | undefined;
  if (!row || !row.enabled || row.revoked_at !== null) throw invalidKey();
  return {
    keyId: row.id,
    userId: row.user_id,
    requestsPerMinute: row.requests_per_minute,
    dailyQuota: row.daily_quota,
  };
}

export async function listGatewayKeys(): Promise<GatewayKeyView[]> {
  const result = await execSql(
    `SELECT keys.*, COALESCE(usage.today_usage, 0)::integer AS today_usage
       FROM (
         SELECT ${PUBLIC_COLUMNS}
           FROM wujie_gateway_keys
       ) AS keys
       LEFT JOIN (
         SELECT gateway_key_id, COUNT(*)::integer AS today_usage
           FROM wujie_gateway_requests
          WHERE admission_status IN ('reserved', 'admitted')
            AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            AND created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'
          GROUP BY gateway_key_id
       ) AS usage ON usage.gateway_key_id = keys.id
      ORDER BY keys.created_at DESC, keys.id ASC`,
  );
  return (result.rows as GatewayKeyRow[]).map(toView);
}

export async function updateGatewayKey(
  keyId: string,
  input: UpdateGatewayKeyInput,
): Promise<GatewayKeyView> {
  validateKeyId(keyId);
  const entries: Array<[string, unknown]> = [];
  if (input.label !== undefined) {
    if (!isBoundedText(input.label, 100)) throw invalidRequest();
    entries.push(['label', input.label.trim()]);
  }
  if (input.requestsPerMinute !== undefined) {
    if (!validRequestsPerMinute(input.requestsPerMinute)) throw invalidRequest();
    entries.push(['requests_per_minute', input.requestsPerMinute]);
  }
  if (input.dailyQuota !== undefined) {
    if (!validDailyQuota(input.dailyQuota)) throw invalidRequest();
    entries.push(['daily_quota', input.dailyQuota]);
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw invalidRequest();
    entries.push(['enabled', input.enabled]);
  }
  if (entries.length === 0) throw invalidRequest();

  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
  const rejectRevokedEnable = input.enabled === true;
  const result = await execSql(
    `WITH changed AS (
       UPDATE wujie_gateway_keys
          SET ${assignments.join(', ')}
        WHERE id = $1${rejectRevokedEnable ? ' AND revoked_at IS NULL' : ''}
        RETURNING ${PUBLIC_COLUMNS}
     )
     SELECT changed.*, COALESCE((
       SELECT COUNT(*)
         FROM wujie_gateway_requests AS usage
        WHERE usage.gateway_key_id = changed.id
          AND usage.admission_status IN ('reserved', 'admitted')
          AND usage.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND usage.created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'
     ), 0)::integer AS today_usage
       FROM changed`,
    [keyId, ...entries.map(([, value]) => value)],
  );
  const row = result.rows[0] as GatewayKeyRow | undefined;
  if (!row && rejectRevokedEnable) {
    const existing = await execSql(
      `SELECT ${PUBLIC_COLUMNS} FROM wujie_gateway_keys WHERE id = $1 LIMIT 1`,
      [keyId],
    );
    const existingRow = existing.rows[0] as GatewayKeyRow | undefined;
    if (existingRow?.revoked_at !== null && existingRow?.revoked_at !== undefined) {
      throw invalidRequest('Revoked gateway keys cannot be enabled', 409);
    }
  }
  if (!row) throw invalidRequest('Gateway key was not found', 404);
  return toView(row);
}

export async function revokeGatewayKey(keyId: string): Promise<GatewayKeyView> {
  validateKeyId(keyId);
  const result = await execSql(
    `WITH changed AS (
       UPDATE wujie_gateway_keys
          SET enabled = FALSE, revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1
        RETURNING ${PUBLIC_COLUMNS}
     )
     SELECT changed.*, COALESCE((
       SELECT COUNT(*)
         FROM wujie_gateway_requests AS usage
        WHERE usage.gateway_key_id = changed.id
          AND usage.admission_status IN ('reserved', 'admitted')
          AND usage.created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND usage.created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'
     ), 0)::integer AS today_usage
       FROM changed`,
    [keyId],
  );
  const row = result.rows[0] as GatewayKeyRow | undefined;
  if (!row) throw invalidRequest('Gateway key was not found', 404);
  return toView(row);
}

export type { GatewayKeyRecord };
