import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), connect: vi.fn(), query: vi.fn(), release: vi.fn(),
  tables: vi.fn(), graph: vi.fn(), providers: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => ({ requireAdminUser: mocks.admin, getProductionAuthConfigurationIssues: () => [] }));
vi.mock('@/lib/payment-config', () => ({ getProductionPaymentConfigurationIssues: () => [] }));
vi.mock('@/lib/task-event-transport', () => ({ getTaskEventTransportReadinessIssue: () => null }));
vi.mock('@/lib/server-api-config', () => ({ getApiProviders: mocks.providers }));
vi.mock('@/lib/cloud-task-storage', () => ({ ensureCloudTaskTables: mocks.tables }));
vi.mock('@/lib/asset-core/asset-release-readiness', () => ({ collectAssetGraphReleaseReadiness: mocks.graph }));
vi.mock('@/lib/db-client', () => ({ getPool: () => ({ connect: mocks.connect }) }));

import { GET } from '@/app/api/admin/production-readiness/route';
const request = (mode = 'database-identity') => new NextRequest(`https://readiness.invalid/api/admin/production-readiness?diagnostics=${mode}`);
const identity = { role: 'synthetic_runtime', session_role: 'synthetic_session', schema: 'public',
  database_name: 'synthetic-private-database', server_address: '192.0.2.90', server_port: 5432,
  server_version: 'synthetic-server-version', bypass_rls: false, superuser: false };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('administrator runtime database identity', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.admin.mockResolvedValue({ id: 'synthetic-admin', role: 'admin' });
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockImplementation(async (sql: string) => ({ rows: /SELECT\b/i.test(sql) ? [identity] : [] }));
    mocks.providers.mockResolvedValue([]); mocks.graph.mockResolvedValue({ blockingCurrentRelease: false });
  });

  it('denies unauthenticated and non-admin callers before any database or configuration read', async () => {
    mocks.admin.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.tables).not.toHaveBeenCalled();
    expect(mocks.graph).not.toHaveBeenCalled(); expect(mocks.providers).not.toHaveBeenCalled();
  });

  it('uses a bounded readonly transaction and returns metadata without a connection target or credential', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.identity).toMatchObject({ source: 'application-runtime', role: identity.role, sessionRole: identity.session_role,
      schema: 'public', bypassRls: false, superuser: false, databaseNameSha256: sha(identity.database_name),
      serverAddressSha256: sha(identity.server_address), serverVersionSha256: sha(identity.server_version) });
    expect(Number.isFinite(Date.parse(result.identity.observedAt))).toBe(true);
    const encoded = JSON.stringify(result);
    for (const privateValue of [identity.database_name, identity.server_address, identity.server_version]) expect(encoded).not.toContain(privateValue);
    const calls = mocks.query.mock.calls.map(([sql]) => sql as string);
    expect(calls).toHaveLength(4); expect(calls[0]).toBe('BEGIN READ ONLY');
    expect(calls[1]).toBe("SET LOCAL statement_timeout = '2000ms'");
    expect(calls[2]).toContain('current_user'); expect(calls[2]).toContain('session_user');
    expect(calls[3]).toBe('ROLLBACK');
    expect(calls.join('\n')).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|pg_terminate_backend)\b/i);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.tables).not.toHaveBeenCalled(); expect(mocks.graph).not.toHaveBeenCalled(); expect(mocks.providers).not.toHaveBeenCalled();
  });

  it.each(['connect', 'select', 'rollback'])('returns only a fixed error on %s failure and disposes its owned connection safely', async stage => {
    const privateError = new Error('synthetic-private-password@database-target');
    if (stage === 'connect') mocks.connect.mockRejectedValue(privateError);
    else mocks.query.mockImplementation(async (sql: string) => {
      if ((stage === 'select' && /SELECT\b/i.test(sql)) || (stage === 'rollback' && sql === 'ROLLBACK')) throw privateError;
      return { rows: [] };
    });
    const response = await GET(request());
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: false, code: 'DATABASE_IDENTITY_UNAVAILABLE' });
    if (stage === 'connect') expect(mocks.release).not.toHaveBeenCalled();
    else expect(mocks.release).toHaveBeenCalledExactlyOnceWith(stage === 'rollback');
    expect(mocks.tables).not.toHaveBeenCalled(); expect(mocks.graph).not.toHaveBeenCalled(); expect(mocks.providers).not.toHaveBeenCalled();
  });

  it('does not fall through to schema checks for an unknown diagnostic mode', async () => {
    expect((await GET(request('unknown-mode'))).status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.tables).not.toHaveBeenCalled(); expect(mocks.graph).not.toHaveBeenCalled();
  });
});
