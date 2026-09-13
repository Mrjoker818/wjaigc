import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('@/lib/db-client', () => ({
  getPool: () => ({ connect: mocks.connect }),
}));

import {
  markGatewayAdmitted,
  markGatewayRejected,
  recordGatewayAttempt,
  reserveGatewayRequest,
} from '@/lib/media-gateway/admission';

interface ScriptedResult {
  rows?: Record<string, unknown>[];
  rowCount?: number;
}

function clientWith(results: ScriptedResult[]) {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    void text;
    void values;
    const next = results.shift();
    if (!next) return { rows: [], rowCount: 0 };
    return { rows: next.rows ?? [], rowCount: next.rowCount ?? next.rows?.length ?? 0 };
  });
  return { query, release: vi.fn() };
}

function sqlAt(
  query: { mock: { calls: readonly (readonly unknown[])[] } },
  index: number,
): string {
  return String(query.mock.calls[index]?.[0]);
}

const principal = {
  keyId: 'gwkey_test', userId: 'user-test', requestsPerMinute: 10, dailyQuota: 5,
};
const reservedRow = {
  id: 'gwreq_test', gateway_key_id: principal.keyId, user_id: principal.userId,
  idempotency_key: 'request-1', request_digest: 'a'.repeat(64), media_type: 'image',
  admission_status: 'reserved', task_ids: [], rejection_code: null,
  created_at: new Date('2026-09-13T01:02:03Z'), updated_at: new Date('2026-09-13T01:02:03Z'),
};

describe('media gateway admission transactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records one atomic RPM attempt and consumes its permit without incrementing again', async () => {
    const attemptClient = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 1 }] },
      {},
    ]);
    const reserveClient = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [] },
      { rows: [reservedRow] },
      { rows: [reservedRow] },
      {},
    ]);
    mocks.connect.mockResolvedValueOnce(attemptClient).mockResolvedValueOnce(reserveClient);

    const attemptPermit = await recordGatewayAttempt(principal);
    await expect(reserveGatewayRequest({
      principal, attemptPermit, idempotencyKey: 'request-1',
      requestDigest: 'a'.repeat(64), mediaType: 'image', requestId: 'gwreq_test',
    })).resolves.toMatchObject({ kind: 'execute' });

    expect(attemptClient.query.mock.calls.filter(([sql]) => (
      /wujie_gateway_rate_windows/i.test(String(sql))
    ))).toHaveLength(1);
    expect(reserveClient.query.mock.calls.some(([sql]) => (
      /wujie_gateway_rate_windows/i.test(String(sql))
    ))).toBe(false);
  });

  it('fails closed for forged, cross-principal, and reused attempt permits', async () => {
    await expect(reserveGatewayRequest({
      principal, attemptPermit: {} as never, idempotencyKey: 'request-1',
      requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({ code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503 });
    expect(mocks.connect).not.toHaveBeenCalled();

    const crossAttemptClient = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 1 }] },
      {},
    ]);
    mocks.connect.mockResolvedValueOnce(crossAttemptClient);
    const crossPermit = await recordGatewayAttempt(principal);
    await expect(reserveGatewayRequest({
      principal: { ...principal, userId: 'other-user' }, attemptPermit: crossPermit,
      idempotencyKey: 'request-1', requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({ code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503 });

    const validAttemptClient = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 1 }] },
      {},
    ]);
    const validReserveClient = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [reservedRow] },
      {},
    ]);
    mocks.connect.mockResolvedValueOnce(validAttemptClient).mockResolvedValueOnce(validReserveClient);
    const usedPermit = await recordGatewayAttempt(principal);
    await reserveGatewayRequest({
      principal, attemptPermit: usedPermit, idempotencyKey: 'request-1',
      requestDigest: 'a'.repeat(64), mediaType: 'image',
    });
    await expect(reserveGatewayRequest({
      principal, attemptPermit: usedPermit, idempotencyKey: 'request-1',
      requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({ code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503 });
    expect(mocks.connect).toHaveBeenCalledTimes(3);
  });

  it('locks the key, increments the minute, reserves idempotency, then locks quota', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 1 }] },
      { rows: [] },
      { rows: [reservedRow] },
      { rows: [reservedRow] },
      {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal, idempotencyKey: 'request-1', requestDigest: 'a'.repeat(64), mediaType: 'image',
      now: new Date('2026-09-13T01:02:03Z'), requestId: 'gwreq_test',
    })).resolves.toMatchObject({ kind: 'execute', request: { id: 'gwreq_test', admissionStatus: 'reserved' } });

    const sql = client.query.mock.calls.map(([text]) => String(text).replace(/\s+/g, ' ').trim());
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toMatch(/FROM wujie_gateway_keys.+FOR UPDATE/i);
    expect(sql[2]).toMatch(/INSERT INTO wujie_gateway_rate_windows.+ON CONFLICT.+DO UPDATE/i);
    expect(sql[3]).toMatch(/FROM wujie_gateway_requests.+idempotency_key/i);
    expect(sql[4]).toMatch(/INSERT INTO wujie_gateway_requests/i);
    expect(sql[5]).toMatch(/FROM wujie_gateway_requests.+FOR UPDATE/i);
    expect(sql[6]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reuses the existing reservation for the same key and digest', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 2 }] },
      { rows: [reservedRow] },
      {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal, idempotencyKey: 'request-1', requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).resolves.toMatchObject({ kind: 'reuse', request: { id: 'gwreq_test' } });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('commits counted rate-limit attempts before returning 429', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 11 }] },
      {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal, idempotencyKey: 'request-1', requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({ code: 'GATEWAY_RATE_LIMITED', status: 429, retryable: true });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('fails closed when committing a counted rejection fails', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10,
            daily_quota: 5, enabled: true, revoked_at: null }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ attempt_count: 11 }], rowCount: 1 })
        .mockRejectedValueOnce(new Error('commit connection lost'))
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal, idempotencyKey: 'request-1', requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({
      code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503,
      message: 'Gateway admission is unavailable', retryable: true,
    });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('returns conflict for the same idempotency key with a different digest', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 2 }] },
      { rows: [reservedRow] },
      {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal, idempotencyKey: 'request-1', requestDigest: 'b'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({ code: 'GATEWAY_IDEMPOTENCY_CONFLICT', status: 409 });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it.each([
    ['', false],
    ['a', true],
    ['a'.repeat(200), true],
    ['a'.repeat(201), false],
    ['contains space', false],
  ])('enforces idempotency key character and 1 through 200 length boundaries', async (idempotencyKey, valid) => {
    const existing = { ...reservedRow, idempotency_key: idempotencyKey };
    const client = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 5, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 1 }] },
      ...(valid ? [{ rows: [existing] }] : []),
      {},
    ]);
    mocks.connect.mockResolvedValue(client);

    const pending = reserveGatewayRequest({
      principal, idempotencyKey, requestDigest: 'a'.repeat(64), mediaType: 'image',
    });
    if (valid) {
      await expect(pending).resolves.toMatchObject({ kind: 'reuse' });
    } else {
      await expect(pending).rejects.toMatchObject({ code: 'GATEWAY_INVALID_REQUEST', status: 400 });
    }
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('removes a new reservation but retains the rate attempt when quota is exhausted', async () => {
    const client = clientWith([
      {},
      { rows: [{ id: principal.keyId, user_id: principal.userId, requests_per_minute: 10, daily_quota: 1, enabled: true, revoked_at: null }] },
      { rows: [{ attempt_count: 1 }] },
      { rows: [] },
      { rows: [reservedRow] },
      { rows: [reservedRow, { ...reservedRow, id: 'gwreq_existing', admission_status: 'admitted' }] },
      {},
      {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal: { ...principal, dailyQuota: 1 }, idempotencyKey: 'request-1',
      requestDigest: 'a'.repeat(64), mediaType: 'image', requestId: 'gwreq_test',
    })).rejects.toMatchObject({ code: 'GATEWAY_DAILY_QUOTA_EXCEEDED', status: 429 });
    expect(sqlAt(client.query, 6)).toMatch(/DELETE FROM wujie_gateway_requests/i);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('fails closed and rolls back on database errors without exposing details', async () => {
    const databaseError = new Error('password=secret database exploded');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockRejectedValueOnce(databaseError)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);

    await expect(reserveGatewayRequest({
      principal, idempotencyKey: 'request-1', requestDigest: 'a'.repeat(64), mediaType: 'image',
    })).rejects.toMatchObject({
      code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503,
      message: 'Gateway admission is unavailable', retryable: true,
    });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('marks a reservation admitted exactly once with authoritative task ids', async () => {
    const admitted = { ...reservedRow, admission_status: 'admitted', task_ids: ['task-1', 'task-2'] };
    const client = clientWith([
      {}, { rows: [{ gateway_key_id: principal.keyId }] }, { rowCount: 1 }, { rows: [admitted] }, {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(markGatewayAdmitted({
      gatewayRequestId: 'gwreq_test', taskIds: ['task-1', 'task-2'],
    })).resolves.toMatchObject({ admissionStatus: 'admitted', taskIds: ['task-1', 'task-2'] });
    expect(sqlAt(client.query, 2)).toMatch(/wujie_gateway_keys.+FOR UPDATE/i);
    expect(sqlAt(client.query, 3)).toMatch(/admission_status = 'reserved'/i);
  });

  it('marks only explicit no-task rejection and leaves ambiguous outcomes reserved', async () => {
    const rejected = { ...reservedRow, admission_status: 'rejected', rejection_code: 'MODEL_NOT_AUTHORIZED' };
    const client = clientWith([
      {}, { rows: [{ gateway_key_id: principal.keyId }] }, { rowCount: 1 }, { rows: [rejected] }, {},
    ]);
    mocks.connect.mockResolvedValue(client);

    await expect(markGatewayRejected({
      gatewayRequestId: 'gwreq_test', rejectionCode: 'MODEL_NOT_AUTHORIZED', outcome: 'explicit',
    })).resolves.toMatchObject({ admissionStatus: 'rejected' });

    vi.clearAllMocks();
    await expect(markGatewayRejected({
      gatewayRequestId: 'gwreq_test', rejectionCode: 'UPSTREAM_TIMEOUT', outcome: 'ambiguous',
    })).rejects.toMatchObject({ code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
