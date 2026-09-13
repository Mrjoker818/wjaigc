import { randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';

import { getPool } from '@/lib/db-client';
import type { GatewayPrincipal } from '@/lib/media-gateway/key-service';
import {
  GatewayError,
  type GatewayMediaType,
  type GatewayRequestRecord,
} from '@/lib/media-gateway/types';

export type GatewayAdmissionDecision =
  | { kind: 'execute'; request: GatewayRequestRecord }
  | { kind: 'reuse'; request: GatewayRequestRecord };

export interface ReserveGatewayRequestInput {
  principal: GatewayPrincipal;
  idempotencyKey: string;
  requestDigest: string;
  mediaType: GatewayMediaType;
  now?: Date;
  requestId?: string;
}

export interface MarkGatewayAdmittedInput {
  gatewayRequestId: string;
  taskIds: string[];
}

export interface MarkGatewayRejectedInput {
  gatewayRequestId: string;
  rejectionCode: string;
  outcome: 'explicit' | 'ambiguous';
}

interface GatewayRequestRow extends QueryResultRow {
  id: string;
  gateway_key_id: string;
  user_id: string;
  idempotency_key: string;
  request_digest: string;
  media_type: GatewayMediaType;
  admission_status: 'reserved' | 'admitted' | 'rejected';
  task_ids: unknown;
  rejection_code: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const REQUEST_COLUMNS = `
  id, gateway_key_id, user_id, idempotency_key, request_digest, media_type,
  admission_status, task_ids, rejection_code, created_at, updated_at
`;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/;
const RECORD_ID_PATTERN = /^gwreq_[A-Za-z0-9-]{1,100}$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRecord(row: GatewayRequestRow): GatewayRequestRecord {
  const taskIds = Array.isArray(row.task_ids)
    ? row.task_ids.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    id: row.id,
    gatewayKeyId: row.gateway_key_id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    mediaType: row.media_type,
    admissionStatus: row.admission_status,
    taskIds,
    rejectionCode: row.rejection_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function unavailable(): GatewayError {
  return new GatewayError(
    'GATEWAY_INTERNAL_UNAVAILABLE',
    503,
    'Gateway admission is unavailable',
    true,
  );
}

function invalid(message: string): GatewayError {
  return new GatewayError('GATEWAY_INVALID_REQUEST', 400, message);
}

async function rollback(client: PoolClient | undefined, transactionOpen: boolean): Promise<void> {
  if (!client || !transactionOpen) return;
  await client.query('ROLLBACK').catch(() => undefined);
}

function validateReservationInput(input: ReserveGatewayRequestInput): void {
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey) || input.idempotencyKey.length > 200) {
    throw invalid('Idempotency key is invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.requestDigest)) throw invalid('Request digest is invalid');
  if (!['image', 'video'].includes(input.mediaType)) throw invalid('Media type is invalid');
  if (input.requestId !== undefined && !RECORD_ID_PATTERN.test(input.requestId)) {
    throw invalid('Gateway request id is invalid');
  }
}

async function commitCountedError(client: PoolClient, error: GatewayError): Promise<GatewayError> {
  await client.query('COMMIT');
  return error;
}

export async function reserveGatewayRequest(
  input: ReserveGatewayRequestInput,
): Promise<GatewayAdmissionDecision> {
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    transactionOpen = true;

    const keyResult = await client.query<{
      id: string;
      user_id: string;
      requests_per_minute: number;
      daily_quota: number;
      enabled: boolean;
      revoked_at: string | Date | null;
    }>(
      `SELECT id, user_id, requests_per_minute, daily_quota, enabled, revoked_at
         FROM wujie_gateway_keys
        WHERE id = $1
        FOR UPDATE`,
      [input.principal.keyId],
    );
    const key = keyResult.rows[0];
    if (!key || key.user_id !== input.principal.userId || !key.enabled || key.revoked_at !== null) {
      const error = await commitCountedError(client, new GatewayError(
        'GATEWAY_KEY_INVALID', 401, 'Gateway key is invalid',
      ));
      transactionOpen = false;
      throw error;
    }

    const now = input.now ?? new Date();
    const rateResult = await client.query<{ attempt_count: number }>(
      `INSERT INTO wujie_gateway_rate_windows (gateway_key_id, window_start, attempt_count)
       VALUES ($1, date_trunc('minute', $2::timestamptz), 1)
       ON CONFLICT (gateway_key_id, window_start)
       DO UPDATE SET attempt_count = wujie_gateway_rate_windows.attempt_count + 1
       RETURNING attempt_count`,
      [key.id, now.toISOString()],
    );
    const attemptCount = Number(rateResult.rows[0]?.attempt_count);
    if (!Number.isInteger(attemptCount)) throw unavailable();
    if (attemptCount > key.requests_per_minute) {
      const error = await commitCountedError(client, new GatewayError(
        'GATEWAY_RATE_LIMITED',
        429,
        '请求过于频繁，请稍后重试',
        true,
      ));
      transactionOpen = false;
      throw error;
    }

    try {
      validateReservationInput(input);
    } catch (error) {
      if (error instanceof GatewayError) {
        const committedError = await commitCountedError(client, error);
        transactionOpen = false;
        throw committedError;
      }
      throw error;
    }

    const existingResult = await client.query<GatewayRequestRow>(
      `SELECT ${REQUEST_COLUMNS}
         FROM wujie_gateway_requests
        WHERE gateway_key_id = $1 AND idempotency_key = $2`,
      [key.id, input.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      if (existing.request_digest !== input.requestDigest || existing.media_type !== input.mediaType) {
        const error = await commitCountedError(client, new GatewayError(
          'GATEWAY_IDEMPOTENCY_CONFLICT',
          409,
          'Idempotency key is already bound to another request',
        ));
        transactionOpen = false;
        throw error;
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return { kind: 'reuse', request: toRecord(existing) };
    }

    const requestId = input.requestId ?? `gwreq_${randomUUID()}`;
    const insertedResult = await client.query<GatewayRequestRow>(
      `INSERT INTO wujie_gateway_requests (
         id, gateway_key_id, user_id, idempotency_key, request_digest,
         media_type, admission_status, task_ids, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'reserved', '[]'::jsonb, $7, $7)
       RETURNING ${REQUEST_COLUMNS}`,
      [
        requestId,
        key.id,
        key.user_id,
        input.idempotencyKey,
        input.requestDigest,
        input.mediaType,
        now.toISOString(),
      ],
    );
    const inserted = insertedResult.rows[0];
    if (!inserted) throw unavailable();

    const quotaResult = await client.query<GatewayRequestRow>(
      `SELECT ${REQUEST_COLUMNS}
         FROM wujie_gateway_requests
        WHERE gateway_key_id = $1
          AND admission_status IN ('reserved', 'admitted')
          AND created_at >= date_trunc('day', $2::timestamptz)
          AND created_at < date_trunc('day', $2::timestamptz) + interval '1 day'
        ORDER BY created_at, id
        FOR UPDATE`,
      [key.id, now.toISOString()],
    );
    if (key.daily_quota > 0 && quotaResult.rows.length > key.daily_quota) {
      await client.query(
        `DELETE FROM wujie_gateway_requests
          WHERE id = $1 AND admission_status = 'reserved' AND task_ids = '[]'::jsonb`,
        [requestId],
      );
      const error = await commitCountedError(client, new GatewayError(
        'GATEWAY_DAILY_QUOTA_EXCEEDED',
        429,
        'Gateway daily quota exceeded',
      ));
      transactionOpen = false;
      throw error;
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return { kind: 'execute', request: toRecord(inserted) };
  } catch (error) {
    await rollback(client, transactionOpen);
    if (error instanceof GatewayError) throw error;
    throw unavailable();
  } finally {
    client?.release();
  }
}

async function gatewayKeyIdForRequest(
  client: PoolClient,
  gatewayRequestId: string,
): Promise<string> {
  const result = await client.query<{ gateway_key_id: string }>(
    'SELECT gateway_key_id FROM wujie_gateway_requests WHERE id = $1',
    [gatewayRequestId],
  );
  const keyId = result.rows[0]?.gateway_key_id;
  if (!keyId) throw unavailable();
  return keyId;
}

async function lockGatewayKey(client: PoolClient, keyId: string): Promise<void> {
  const result = await client.query(
    'SELECT id FROM wujie_gateway_keys WHERE id = $1 FOR UPDATE',
    [keyId],
  );
  if (result.rowCount !== 1) throw unavailable();
}

async function runStatusTransition(
  gatewayRequestId: string,
  transition: (client: PoolClient) => Promise<GatewayRequestRow | undefined>,
): Promise<GatewayRequestRecord> {
  if (!RECORD_ID_PATTERN.test(gatewayRequestId)) throw invalid('Gateway request id is invalid');
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const keyId = await gatewayKeyIdForRequest(client, gatewayRequestId);
    await lockGatewayKey(client, keyId);
    const row = await transition(client);
    if (!row) throw unavailable();
    await client.query('COMMIT');
    transactionOpen = false;
    return toRecord(row);
  } catch (error) {
    await rollback(client, transactionOpen);
    if (error instanceof GatewayError) throw error;
    throw unavailable();
  } finally {
    client?.release();
  }
}

export async function markGatewayAdmitted(
  input: MarkGatewayAdmittedInput,
): Promise<GatewayRequestRecord> {
  if (
    !Array.isArray(input.taskIds)
    || input.taskIds.length === 0
    || input.taskIds.some((taskId) => !TASK_ID_PATTERN.test(taskId))
    || new Set(input.taskIds).size !== input.taskIds.length
  ) {
    throw invalid('Authoritative task ids are invalid');
  }
  return runStatusTransition(input.gatewayRequestId, async (client) => {
    const result = await client.query<GatewayRequestRow>(
      `UPDATE wujie_gateway_requests
          SET admission_status = 'admitted', task_ids = $2::jsonb,
              rejection_code = NULL, updated_at = now()
        WHERE id = $1 AND admission_status = 'reserved' AND task_ids = '[]'::jsonb
        RETURNING ${REQUEST_COLUMNS}`,
      [input.gatewayRequestId, JSON.stringify(input.taskIds)],
    );
    if (result.rows[0]) return result.rows[0];
    const existing = await client.query<GatewayRequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM wujie_gateway_requests WHERE id = $1 FOR UPDATE`,
      [input.gatewayRequestId],
    );
    const row = existing.rows[0];
    if (
      row?.admission_status === 'admitted'
      && JSON.stringify(toRecord(row).taskIds) === JSON.stringify(input.taskIds)
    ) return row;
    return undefined;
  });
}

export async function markGatewayRejected(
  input: MarkGatewayRejectedInput,
): Promise<GatewayRequestRecord> {
  if (input.outcome !== 'explicit') throw unavailable();
  if (!TASK_ID_PATTERN.test(input.rejectionCode)) throw invalid('Rejection code is invalid');
  return runStatusTransition(input.gatewayRequestId, async (client) => {
    const result = await client.query<GatewayRequestRow>(
      `UPDATE wujie_gateway_requests
          SET admission_status = 'rejected', rejection_code = $2, updated_at = now()
        WHERE id = $1 AND admission_status = 'reserved' AND task_ids = '[]'::jsonb
        RETURNING ${REQUEST_COLUMNS}`,
      [input.gatewayRequestId, input.rejectionCode],
    );
    if (result.rows[0]) return result.rows[0];
    const existing = await client.query<GatewayRequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM wujie_gateway_requests WHERE id = $1 FOR UPDATE`,
      [input.gatewayRequestId],
    );
    const row = existing.rows[0];
    if (
      row?.admission_status === 'rejected'
      && row.rejection_code === input.rejectionCode
      && toRecord(row).taskIds.length === 0
    ) return row;
    return undefined;
  });
}
