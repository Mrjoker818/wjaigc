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
