import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn('BLOCKED: media gateway admission requires POSTGRES_TEST_DATABASE_URL');
}

async function prepareSchema(query: (text: string, values?: unknown[]) => Promise<unknown>): Promise<void> {
  await query(`CREATE TABLE wujie_users (id TEXT PRIMARY KEY)`);
  const migration = await readFile('migrations/20260913_v588_media_gateway.sql', 'utf8');
  await query(migration);
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    principal: {
      keyId: 'gwkey_concurrency', userId: 'gateway-user', requestsPerMinute: 100, dailyQuota: 100,
    },
    idempotencyKey: 'same-request', requestDigest: 'a'.repeat(64), mediaType: 'image' as const,
    ...overrides,
  };
}

describe('media gateway admission on PostgreSQL', () => {
  postgresIt('keeps admission and admin usage aligned in a non-UTC session', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-non-utc-day-window', async ({ databaseUrl, query }) => {
      await prepareSchema(query);
      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user')`);
      await query(`INSERT INTO wujie_gateway_keys
        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
        VALUES ('gwkey_timezone', 'gateway-user', 'hash', 'wmg_time0000', 'timezone', 100, 1, 'admin')`);
      const boundary = await query(
        `SELECT date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS utc_start`,
      ) as { rows: Array<{ utc_start: Date }> };
      const utcStart = new Date(boundary.rows[0].utc_start);
      const previousDay = new Date(utcStart.getTime() - 30 * 60_000);
      const currentDay = new Date(utcStart.getTime() + 30 * 60_000);
      await query(`INSERT INTO wujie_gateway_requests
        (id, gateway_key_id, user_id, idempotency_key, request_digest, media_type, admission_status, created_at)
        VALUES ('gwreq_previous_timezone', 'gwkey_timezone', 'gateway-user', 'previous', repeat('b', 64),
          'image', 'admitted', $1)`, [previousDay.toISOString()]);

      const nonUtcUrl = new URL(databaseUrl);
      const existingOptions = nonUtcUrl.searchParams.get('options');
      nonUtcUrl.searchParams.set(
        'options',
        [existingOptions, '-cTimeZone=Asia/Shanghai'].filter(Boolean).join(' '),
      );
      const { closePool, execSql } = await import('@/lib/db-client');
      await closePool();
      process.env.DATABASE_URL = nonUtcUrl.toString();
      process.env.PGDATABASE_URL = nonUtcUrl.toString();
      expect((await execSql('SHOW TIME ZONE')).rows[0]?.TimeZone).toBe('Asia/Shanghai');

      const { reserveGatewayRequest } = await import('@/lib/media-gateway/admission');
      const { listGatewayKeys } = await import('@/lib/media-gateway/key-service');
      await expect(reserveGatewayRequest(input({
        principal: { ...input().principal, keyId: 'gwkey_timezone', dailyQuota: 1 },
        idempotencyKey: 'current',
        now: currentDay,
      }))).resolves.toMatchObject({ kind: 'execute' });

      const keys = await listGatewayKeys();
      expect(keys.find((candidate) => candidate.id === 'gwkey_timezone')?.todayUsage).toBe(1);
    });
  }, 30_000);

  postgresIt('projects authoritative UTC daily usage from reserved and admitted requests only', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-admin-daily-usage', async ({ query }) => {
      await prepareSchema(query);
      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user'), ('other-user')`);
      await query(`INSERT INTO wujie_gateway_keys
        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
        VALUES
          ('gwkey_usage_target', 'gateway-user', 'hash-target', 'wmg_target00', 'target', 100, 100, 'admin'),
          ('gwkey_usage_other', 'other-user', 'hash-other', 'wmg_other000', 'other', 100, 100, 'admin')`);
      await query(`INSERT INTO wujie_gateway_requests
        (id, gateway_key_id, user_id, idempotency_key, request_digest, media_type, admission_status, created_at)
        VALUES
          ('gwreq_reserved', 'gwkey_usage_target', 'gateway-user', 'reserved', repeat('a', 64), 'image', 'reserved',
           (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '1 hour') AT TIME ZONE 'UTC'),
          ('gwreq_admitted', 'gwkey_usage_target', 'gateway-user', 'admitted', repeat('b', 64), 'video', 'admitted',
           (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '2 hours') AT TIME ZONE 'UTC'),
          ('gwreq_rejected', 'gwkey_usage_target', 'gateway-user', 'rejected', repeat('c', 64), 'image', 'rejected',
           (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '3 hours') AT TIME ZONE 'UTC'),
          ('gwreq_previous', 'gwkey_usage_target', 'gateway-user', 'previous', repeat('d', 64), 'image', 'admitted',
           (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - interval '1 second') AT TIME ZONE 'UTC'),
          ('gwreq_other', 'gwkey_usage_other', 'other-user', 'other', repeat('e', 64), 'image', 'admitted',
           (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '4 hours') AT TIME ZONE 'UTC')`);
      const { listGatewayKeys } = await import('@/lib/media-gateway/key-service');

      const keys = await listGatewayKeys();

      expect(keys.find(key => key.id === 'gwkey_usage_target')?.todayUsage).toBe(2);
      expect(keys.find(key => key.id === 'gwkey_usage_other')?.todayUsage).toBe(1);
    });
  }, 30_000);

  postgresIt('allows exactly one execute across 20 identical concurrent reservations', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-same-idempotency', async ({ query }) => {
      await prepareSchema(query);
      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user')`);
      await query(`INSERT INTO wujie_gateway_keys
        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
        VALUES ('gwkey_concurrency', 'gateway-user', 'hash', 'wmg_test', 'test', 100, 100, 'admin')`);
      const { reserveGatewayRequest } = await import('@/lib/media-gateway/admission');

      const decisions = await Promise.all(Array.from({ length: 20 }, () => reserveGatewayRequest(input())));
      expect(decisions.filter(({ kind }) => kind === 'execute')).toHaveLength(1);
      expect(decisions.filter(({ kind }) => kind === 'reuse')).toHaveLength(19);
      expect(new Set(decisions.map(({ request }) => request.id)).size).toBe(1);

      const rows = await query(`SELECT admission_status FROM wujie_gateway_requests`);
      expect((rows as { rows: unknown[] }).rows).toHaveLength(1);
    });
  }, 30_000);

  postgresIt('never exceeds the minute limit under 20-way contention', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-minute-limit', async ({ query }) => {
      await prepareSchema(query);
      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user')`);
      await query(`INSERT INTO wujie_gateway_keys
        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
        VALUES ('gwkey_concurrency', 'gateway-user', 'hash', 'wmg_test', 'test', 5, 100, 'admin')`);
      const { reserveGatewayRequest } = await import('@/lib/media-gateway/admission');

      const settled = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => reserveGatewayRequest(input({
        principal: { ...input().principal, requestsPerMinute: 5 },
        idempotencyKey: `minute-${index}`,
      }))));
      expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(5);
      expect(settled.filter((result) => result.status === 'rejected'
        && (result.reason as { code?: string }).code === 'GATEWAY_RATE_LIMITED')).toHaveLength(15);
      const count = await query<{ attempt_count: number }>(
        `SELECT attempt_count FROM wujie_gateway_rate_windows`,
      );
      expect(count.rows[0]?.attempt_count).toBe(20);
    });
  }, 30_000);

  postgresIt('does not oversell daily quota to 20 distinct concurrent reservations', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-daily-quota', async ({ query }) => {
      await prepareSchema(query);
      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user')`);
      await query(`INSERT INTO wujie_gateway_keys
        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
        VALUES ('gwkey_concurrency', 'gateway-user', 'hash', 'wmg_test', 'test', 100, 4, 'admin')`);
      const { reserveGatewayRequest } = await import('@/lib/media-gateway/admission');

      const settled = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => reserveGatewayRequest(input({
        principal: { ...input().principal, dailyQuota: 4 },
        idempotencyKey: `quota-${index}`,
      }))));
      expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(4);
      expect(settled.filter((result) => result.status === 'rejected'
        && (result.reason as { code?: string }).code === 'GATEWAY_DAILY_QUOTA_EXCEEDED')).toHaveLength(16);
      const requests = await query(`SELECT admission_status FROM wujie_gateway_requests`);
      expect((requests as { rows: unknown[] }).rows).toHaveLength(4);
    });
  }, 30_000);

  postgresIt('returns 409 for a different digest and keeps ambiguous timeout reserved', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('gateway-conflict-timeout', async ({ query }) => {
      await prepareSchema(query);
      await query(`INSERT INTO wujie_users (id) VALUES ('gateway-user')`);
      await query(`INSERT INTO wujie_gateway_keys
        (id, user_id, key_hash, key_prefix, label, requests_per_minute, daily_quota, created_by)
        VALUES ('gwkey_concurrency', 'gateway-user', 'hash', 'wmg_test', 'test', 100, 100, 'admin')`);
      const { markGatewayRejected, reserveGatewayRequest } = await import('@/lib/media-gateway/admission');
      const first = await reserveGatewayRequest(input());
      await expect(reserveGatewayRequest(input({ requestDigest: 'b'.repeat(64) })))
        .rejects.toMatchObject({ code: 'GATEWAY_IDEMPOTENCY_CONFLICT', status: 409 });
      await expect(markGatewayRejected({
        gatewayRequestId: first.request.id, rejectionCode: 'UPSTREAM_TIMEOUT', outcome: 'ambiguous',
      })).rejects.toMatchObject({ code: 'GATEWAY_INTERNAL_UNAVAILABLE' });
      const row = await query<{ admission_status: string }>(
        `SELECT admission_status FROM wujie_gateway_requests WHERE id = $1`,
        [first.request.id],
      );
      expect(row.rows[0]?.admission_status).toBe('reserved');
    });
  });

  postgresIt('fails closed when PostgreSQL is unavailable', async () => {
    const { closePool } = await import('@/lib/db-client');
    const { reserveGatewayRequest } = await import('@/lib/media-gateway/admission');
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousPgDatabaseUrl = process.env.PGDATABASE_URL;
    await closePool();
    process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/unavailable?connect_timeout=1';
    process.env.PGDATABASE_URL = process.env.DATABASE_URL;
    try {
      await expect(reserveGatewayRequest(input())).rejects.toMatchObject({
        code: 'GATEWAY_INTERNAL_UNAVAILABLE', status: 503, retryable: true,
      });
    } finally {
      await closePool();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousPgDatabaseUrl === undefined) delete process.env.PGDATABASE_URL;
      else process.env.PGDATABASE_URL = previousPgDatabaseUrl;
    }
  }, 15_000);
});
