import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

const identity = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
}));

vi.mock('server-only', () => ({}));
// Identity is isolated; route SQL, PostgreSQL, and projection logic are real.
vi.mock('@/lib/server-auth', () => ({
  ...identity,
  createManagedUser: vi.fn(),
  deleteManagedUser: vi.fn(),
  deleteManagedUsers: vi.fn(),
  isRootAdminUser: vi.fn(),
  repairDuplicateUserIds: vi.fn(),
  updateManagedUser: vi.fn(),
}));
vi.mock('@/lib/server-api-config', () => ({ getPublicModelCatalogSnapshot: vi.fn() }));

import { GET } from '@/app/api/admin/users/route';

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

function user(id: string): User {
  return {
    id,
    name: `Projection ${id}`,
    role: 'user',
    status: 'active',
    createdAt: 1,
    updatedAt: 100,
    credits: 99999,
    project_count: 99999,
    last_login: 99999,
  };
}

async function createProjectionData(query: QueryFn): Promise<void> {
  await query(`CREATE TABLE wujie_credits (user_id TEXT PRIMARY KEY, balance NUMERIC NOT NULL)`);
  await query(`CREATE TABLE wujie_user_data (
    user_id TEXT NOT NULL, data_key TEXT NOT NULL, data_value JSONB, updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, data_key)
  )`);
  await query(`CREATE TABLE wujie_audit_log (user_id TEXT NOT NULL, created_at BIGINT NOT NULL)`);
  await query(`INSERT INTO wujie_credits VALUES ('a', 403.5), ('b', 12), ('orphan', 9000)`);
  await query(`INSERT INTO wujie_user_data VALUES
    ('a', 'projects', '[{"id":"one"},{"id":"two"}]', 200),
    ('a', 'chat-history', '[]', 600),
    ('b', 'projects', '{"one":{},"two":{},"three":{}}', 250),
    ('orphan', 'projects', '[{},{},{},{}]', 9000)
  `);
  await query(`INSERT INTO wujie_audit_log VALUES ('a', 300), ('a', 350), ('b', 400), ('orphan', 9000)`);
}

async function projectionSnapshot(query: QueryFn): Promise<unknown> {
  const result = await query(`SELECT
    (SELECT jsonb_agg(c ORDER BY user_id) FROM wujie_credits c) AS credits,
    (SELECT jsonb_agg(d ORDER BY user_id, data_key) FROM wujie_user_data d) AS data,
    (SELECT jsonb_agg(a ORDER BY user_id, created_at) FROM wujie_audit_log a) AS activity
  `);
  return result.rows;
}

describe('administrator projection with real PostgreSQL', () => {
  beforeEach(() => {
    identity.requireAdminUser.mockReset().mockResolvedValue({ id: 'admin', role: 'admin' });
    identity.listManagedUsers.mockReset().mockResolvedValue([user('a'), user('b'), user('new')]);
  });

  postgresIt('reads authoritative metrics without changing rows or adding orphan identities', async () => {
    await withIsolatedPostgres('admin_projection_read', async ({ query }) => {
      await createProjectionData(query);
      const before = await projectionSnapshot(query);
      const response = await GET(new NextRequest('http://localhost/api/admin/users'));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.projectionCoverage).toEqual({
        identity: 'available', credits: 'available', projects: 'available', activity: 'available',
      });
      expect(body.users).toHaveLength(3);
      expect(body.users).toEqual([
        expect.objectContaining({ id: 'a', credits: 403.5, project_count: 2, last_login: 600 }),
        expect.objectContaining({ id: 'b', credits: 12, project_count: 3, last_login: 400 }),
        expect.objectContaining({ id: 'new', credits: 0, project_count: 0, last_login: 100 }),
      ]);
      expect(await projectionSnapshot(query)).toEqual(before);
    });
  });

  postgresIt('rejects non-admin access before querying authoritative tables', async () => {
    await withIsolatedPostgres('admin_projection_denied', async () => {
      identity.requireAdminUser.mockResolvedValue(null);
      const response = await GET(new NextRequest('http://localhost/api/admin/users'));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false });
      expect(identity.listManagedUsers).not.toHaveBeenCalled();
    });
  });

  postgresIt('returns a business failure when an authoritative table is unavailable', async () => {
    await withIsolatedPostgres('admin_projection_failure', async ({ query }) => {
      await createProjectionData(query);
      await query('ALTER TABLE wujie_credits RENAME TO credits_unavailable');
      const response = await GET(new NextRequest('http://localhost/api/admin/users'));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({ success: false, code: 'ADMIN_USER_PROJECTION_FAILED' });
      expect(body).not.toHaveProperty('users');
      const remaining = await query('SELECT SUM(balance) AS balance FROM credits_unavailable');
      expect(Number(remaining.rows[0]?.balance)).toBe(9415.5);
    });
  });
});
