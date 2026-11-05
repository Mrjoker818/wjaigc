import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  execSql: vi.fn(),
  getPool: vi.fn(() => { throw new Error('Unexpected database connection'); }),
}));

vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, getPool: mocks.getPool }));
vi.mock('@/lib/refund-identity-claim', () => ({ ensureRefundIdentityClaims: vi.fn() }));
vi.mock('@/lib/auth/auth-persistence', () => ({ refreshAuthJsonFileAtomic: vi.fn() }));
vi.mock('@/lib/auth/auth-repository', () => ({ withDatabaseAuthReplicaLock: vi.fn() }));
vi.mock('@/lib/api-provider-selected-models-storage', () => ({ encodeSelectedModelsForStorage: vi.fn(), resolveSelectedModelsStorageKind: vi.fn() }));
vi.mock('@/lib/server-api-config', () => ({ findProviderForFeature: vi.fn(() => { throw new Error('Unexpected provider access'); }) }));
vi.mock('@/lib/api-helpers', () => ({ fetchWithV1Retry: vi.fn(() => { throw new Error('Unexpected network access'); }) }));

import { GET as opLogGet } from '@/app/api/admin/op-log/route';
import { GET as auditGet } from '@/app/api/admin/audit/route';

const routes = [
  { name: 'operation log', get: opLogGet, url: 'http://test.invalid/api/admin/op-log?page=2&pageSize=5' },
  { name: 'audit log', get: auditGet, url: 'http://test.invalid/api/admin/audit?limit=5&offset=5' },
] as const;

describe.each(routes)('$name storage failure contract', ({ get, url }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access'); }));
    mocks.requireAdminUser.mockResolvedValue({ id: 'test-admin', name: 'test-admin' });
    mocks.execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: 0 }], rowCount: 1 };
      if (sql.includes('SELECT * FROM wujie_audit_log')) return { rows: [], rowCount: 0 };
      throw new Error('Unexpected SQL query');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['count', 'rows'] as const)('reports a %s query failure instead of a successful empty list', async (failure) => {
    mocks.execSql.mockImplementation(async (sql: string) => {
      const count = sql.includes('SELECT COUNT(*)');
      const rows = sql.includes('SELECT * FROM wujie_audit_log');
      if ((!count && !rows) || (failure === 'count' && count) || (failure === 'rows' && rows)) {
        throw new Error('synthetic-private-storage-error');
      }
      return { rows: [{ count: 0 }], rowCount: 1 };
    });
    const response = await get(new NextRequest(url));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('synthetic-private-storage-error');
    expect(mocks.execSql).toHaveBeenCalledTimes(failure === 'count' ? 1 : 2);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('returns a successful empty result when both queries succeed', async () => {
    const response = await get(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, logs: [], total: 0 });
    expect(mocks.execSql).toHaveBeenCalledTimes(2);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('rejects a non-admin before reading storage', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);
    const response = await get(new NextRequest(url));
    expect(response.status).toBe(403);
    expect(mocks.execSql).not.toHaveBeenCalled();
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
});