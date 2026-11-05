import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ queries: 0, admin: true }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({
  execSql: async () => { state.queries++; throw Error('SYNTHETIC_SQL_FAILURE'); },
  getPool: () => { throw Error('UNEXPECTED_DATABASE_POOL'); },
  isDatabaseConfigured: () => true,
}));
vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: async () => state.admin ? { id: 'admin' } : null,
  listManagedUsers: async () => [],
}));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: async () => [] }));
vi.mock('@/lib/refund-identity-claim', () => ({ ensureRefundIdentityClaims: async () => { throw Error('unexpected'); } }));
vi.mock('@/lib/auth/auth-persistence', () => ({ refreshAuthJsonFileAtomic: async () => { throw Error('unexpected'); } }));
vi.mock('@/lib/auth/auth-repository', () => ({ withDatabaseAuthReplicaLock: async () => { throw Error('unexpected'); } }));

import { GET as dashboard } from '@/app/api/admin/dashboard-stats/route';
import { GET as credits } from '@/app/api/admin/credits/overview/route';

afterEach(() => vi.restoreAllMocks());

it('returns an error rather than a successful zero when dashboard storage fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.admin = true;
  state.queries = 0;
  const response = await dashboard(new NextRequest('http://localhost/api/admin/dashboard-stats?period=7'));
  const body = await response.json();
  expect(state.queries).toBeGreaterThan(0);
  expect(response.status).toBe(500);
  expect(body.success).toBe(false);
});

it('denies non-admin dashboard and credits reads before querying storage', async () => {
  state.admin = false;
  state.queries = 0;
  const dashboardResponse = await dashboard(new NextRequest('http://localhost/api/admin/dashboard-stats'));
  const creditsResponse = await credits(new NextRequest('http://localhost/api/admin/credits/overview'));
  expect(dashboardResponse.status).toBe(403);
  expect(creditsResponse.status).toBe(403);
  expect(state.queries).toBe(0);
});