import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execSql: vi.fn() }));

vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql }));

import {
  authenticateGatewayBearer,
  issueGatewayKey,
  listGatewayKeys,
  revokeGatewayKey,
  updateGatewayKey,
} from '@/lib/media-gateway/key-service';

const databaseRow = {
  id: 'gwkey_123',
  user_id: 'user-1',
  key_hash: 'stored-hash',
  key_prefix: 'wmg_example',
  label: 'Production',
  requests_per_minute: 60,
  daily_quota: 1000,
  enabled: true,
  created_by: 'admin-1',
  created_at: '2026-09-13T00:00:00.000Z',
  last_used_at: null,
  revoked_at: null,
  today_usage: 12,
};

const validInput = {
  userId: 'user-1',
  label: 'Production',
  requestsPerMinute: 60,
  dailyQuota: 1000,
  createdBy: 'admin-1',
};

describe('media gateway key service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('returns the raw secret once and persists only its sha256 hash', async () => {
    mocks.execSql
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }], rowCount: 1 })
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({
        rows: [{
          ...databaseRow,
          id: params[0],
          key_hash: params[2],
          key_prefix: params[3],
          today_usage: 0,
        }],
        rowCount: 1,
      }))
      .mockResolvedValueOnce({ rows: [databaseRow], rowCount: 1 });

    const issued = await issueGatewayKey(validInput);
    const insert = mocks.execSql.mock.calls[1];
    const inserted = {
      id: insert[1][0],
      userId: insert[1][1],
      keyHash: insert[1][2],
      keyPrefix: insert[1][3],
      label: insert[1][4],
    };

    expect(issued.secret).toMatch(/^wmg_[A-Za-z0-9_-]{43,}$/);
    expect(inserted.keyHash).toBe(createHash('sha256').update(issued.secret).digest('hex'));
    expect(JSON.stringify(inserted)).not.toContain(issued.secret);
    expect(JSON.stringify(issued.key)).not.toContain(issued.secret);
    expect(issued.key.todayUsage).toBe(0);
    expect(JSON.stringify(await listGatewayKeys())).not.toContain(issued.secret);
    expect(String(insert[0])).toContain('RETURNING');
  });

  it('lists keys with authoritative usage aggregated for the current UTC date', async () => {
    mocks.execSql.mockResolvedValueOnce({ rows: [databaseRow], rowCount: 1 });

    await expect(listGatewayKeys()).resolves.toEqual([expect.objectContaining({
      id: 'gwkey_123',
      todayUsage: 12,
    })]);

    const sql = String(mocks.execSql.mock.calls[0][0]);
    expect(sql).toContain('wujie_media_gateway_usage_daily');
    expect(sql).toMatch(/SUM\s*\(.*request_count.*\)/i);
    expect(sql).toMatch(/AT TIME ZONE\s+'UTC'/i);
  });

  it('authenticates and updates last_used_at atomically without enumerating plaintext keys', async () => {
    const secret = `wmg_${'a'.repeat(43)}`;
    mocks.execSql.mockResolvedValueOnce({ rows: [databaseRow], rowCount: 1 });

    await expect(authenticateGatewayBearer(`Bearer ${secret}`)).resolves.toEqual({
      keyId: 'gwkey_123',
      userId: 'user-1',
      requestsPerMinute: 60,
      dailyQuota: 1000,
    });

    const [sql, params] = mocks.execSql.mock.calls[0];
    expect(String(sql).trimStart()).toMatch(/^UPDATE wujie_gateway_keys/);
    expect(String(sql)).toContain('SET last_used_at = now()');
    expect(String(sql)).toContain('key_hash = $1');
    expect(String(sql)).toContain('enabled = TRUE');
    expect(String(sql)).toContain('revoked_at IS NULL');
    expect(String(sql)).toContain('RETURNING');
    expect(params).toEqual([createHash('sha256').update(secret).digest('hex')]);
    expect(JSON.stringify(mocks.execSql.mock.calls)).not.toContain(secret);
  });

  it.each([null, '', 'Basic abc', 'Bearer nope', `Bearer wmg_${'!'.repeat(43)}`])(
    'rejects a malformed bearer value without querying storage',
    async value => {
      await expect(authenticateGatewayBearer(value)).rejects.toMatchObject({
        code: 'GATEWAY_KEY_INVALID',
        status: 401,
      });
      expect(mocks.execSql).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown, disabled, or revoked keys without updating their last-used time', async () => {
    const secret = `wmg_${'b'.repeat(43)}`;
    for (const lifecycleState of ['unknown', 'disabled', 'revoked']) {
      mocks.execSql.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
      await expect(authenticateGatewayBearer(`Bearer ${secret}`)).rejects.toMatchObject({
        code: 'GATEWAY_KEY_INVALID',
        message: 'Gateway key is invalid',
      });
      expect(mocks.execSql, lifecycleState).toHaveBeenCalledTimes(1);
      const sql = String(mocks.execSql.mock.calls[0][0]);
      expect(sql).toContain('SET last_used_at = now()');
      expect(sql).toContain('enabled = TRUE');
      expect(sql).toContain('revoked_at IS NULL');
    }
  });

  it('rejects issue requests for an unknown user before insertion', async () => {
    mocks.execSql.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(issueGatewayKey(validInput)).rejects.toMatchObject({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 404,
    });
    expect(mocks.execSql).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...validInput, label: '' }],
    [{ ...validInput, label: 'x'.repeat(101) }],
    [{ ...validInput, requestsPerMinute: 0 }],
    [{ ...validInput, requestsPerMinute: 601 }],
    [{ ...validInput, dailyQuota: -1 }],
    [{ ...validInput, dailyQuota: 100001 }],
  ])('rejects values outside the database bounds', async input => {
    await expect(issueGatewayKey(input)).rejects.toMatchObject({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 400,
    });
    expect(mocks.execSql).not.toHaveBeenCalled();
  });

  it('updates only mutable fields and returns a secret-free view', async () => {
    mocks.execSql.mockResolvedValueOnce({
      rows: [{ ...databaseRow, label: 'Renamed', requests_per_minute: 12, enabled: false }],
      rowCount: 1,
    });

    const result = await updateGatewayKey('gwkey_123', {
      label: 'Renamed',
      requestsPerMinute: 12,
      enabled: false,
    });

    expect(result).toMatchObject({ id: 'gwkey_123', label: 'Renamed', requestsPerMinute: 12, enabled: false });
    expect(result).not.toHaveProperty('keyHash');
    expect(String(mocks.execSql.mock.calls[0][0])).not.toContain('key_hash =');
  });

  it('rejects re-enabling a revoked key and leaves its state disabled', async () => {
    mocks.execSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ ...databaseRow, enabled: false, revoked_at: '2026-09-13T02:00:00.000Z' }],
        rowCount: 1,
      });

    await expect(updateGatewayKey('gwkey_123', { enabled: true })).rejects.toMatchObject({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 409,
    });

    const updateSql = String(mocks.execSql.mock.calls[0][0]);
    expect(updateSql).toContain('revoked_at IS NULL');
    expect(mocks.execSql.mock.calls[0][1]).toEqual(['gwkey_123', true]);
    expect(mocks.execSql).toHaveBeenCalledTimes(2);
  });

  it('revokes idempotently and never exposes a hash or secret', async () => {
    mocks.execSql.mockResolvedValue({
      rows: [{ ...databaseRow, enabled: false, revoked_at: '2026-09-13T02:00:00.000Z' }],
      rowCount: 1,
    });

    const first = await revokeGatewayKey('gwkey_123');
    const second = await revokeGatewayKey('gwkey_123');

    expect(first).toEqual(second);
    expect(first).not.toHaveProperty('keyHash');
    expect(String(mocks.execSql.mock.calls[0][0])).toContain('COALESCE(revoked_at, now())');
  });
});
