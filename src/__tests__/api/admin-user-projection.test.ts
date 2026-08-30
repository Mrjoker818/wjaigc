import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  execSql: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  createManagedUser: vi.fn(),
  deleteManagedUser: vi.fn(),
  deleteManagedUsers: vi.fn(),
  isRootAdminUser: vi.fn(),
  listManagedUsers: mocks.listManagedUsers,
  repairDuplicateUserIds: vi.fn(),
  requireAdminUser: mocks.requireAdminUser,
  updateManagedUser: vi.fn(),
}));
vi.mock('@/lib/db-storage', () => ({
  dbListUserData: vi.fn(),
  dbGetUserData: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbAddAuditLog: vi.fn(),
}));
vi.mock('@/lib/db-client', () => ({
  isDatabaseConfigured: mocks.isDatabaseConfigured,
  execSql: mocks.execSql,
}));

import { GET } from '@/app/api/admin/users/route';

function managedUser(index: number) {
  return {
    id: `user-${index}`,
    name: `User ${index}`,
    role: 'user' as const,
    status: 'active' as const,
    createdAt: 1,
    updatedAt: 100,
  };
}

describe('GET /api/admin/users authoritative projection', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin', name: 'Admin', role: 'admin' });
    mocks.isDatabaseConfigured.mockReturnValue(true);
    mocks.listManagedUsers.mockResolvedValue([managedUser(1)]);
    mocks.execSql
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', balance: 403 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', data_value: new Array(10).fill({}), updated_at: 200 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1', last_activity: 300 }], rowCount: 1 });
  });

  it('returns authoritative credits, projects and activity with explicit coverage', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/users'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.execSql).toHaveBeenCalledTimes(3);
    expect(mocks.execSql.mock.calls[2]?.[0]).toContain('wujie_audit_log');
    expect(mocks.execSql.mock.calls[2]?.[0]).toContain('wujie_user_data');
    expect(body.projectionCoverage).toEqual({
      identity: 'available',
      credits: 'available',
      projects: 'available',
      activity: 'available',
    });
    expect(body.users[0]).toMatchObject({
      id: 'user-1',
      credits: 403,
      project_count: 10,
      last_login: 300,
    });
  });

  it('uses only three SQL calls for one hundred users', async () => {
    mocks.listManagedUsers.mockResolvedValue(Array.from({ length: 100 }, (_, index) => managedUser(index)));

    await GET(new NextRequest('http://localhost/api/admin/users'));

    expect(mocks.execSql).toHaveBeenCalledTimes(3);
    expect(mocks.execSql.mock.calls[0]?.[1]?.[0]).toHaveLength(100);
  });

  it('does not query projection data for a non-admin request', async () => {
    mocks.requireAdminUser.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/admin/users'));

    expect(response.status).toBe(403);
    expect(mocks.execSql).not.toHaveBeenCalled();
    expect(mocks.listManagedUsers).not.toHaveBeenCalled();
  });

  it('keeps identities but marks projections unavailable when the database is not configured', async () => {
    mocks.isDatabaseConfigured.mockReturnValue(false);

    const response = await GET(new NextRequest('http://localhost/api/admin/users'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.execSql).not.toHaveBeenCalled();
    expect(body.users[0]).toMatchObject({ credits: 0, project_count: 0 });
    expect(body.projectionCoverage).toEqual({
      identity: 'available',
      credits: 'unavailable',
      projects: 'unavailable',
      activity: 'unavailable',
    });
  });

  it('fails closed when an authoritative projection query fails', async () => {
    mocks.execSql.mockReset().mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new NextRequest('http://localhost/api/admin/users'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      success: false,
      code: 'ADMIN_USER_PROJECTION_FAILED',
    });
  });
});
