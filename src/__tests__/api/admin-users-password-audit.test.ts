import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  isRootAdminUser: vi.fn(),
  listManagedUsers: vi.fn(),
  updateManagedUser: vi.fn(),
  repairDuplicateUserIds: vi.fn(),
  dbAddAuditLog: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  createManagedUser: vi.fn(),
  deleteManagedUser: vi.fn(),
  isRootAdminUser: mocks.isRootAdminUser,
  listManagedUsers: mocks.listManagedUsers,
  requireAdminUser: mocks.requireAdminUser,
  repairDuplicateUserIds: mocks.repairDuplicateUserIds,
  updateManagedUser: mocks.updateManagedUser,
}));

vi.mock('@/lib/db-storage', () => ({
  dbListUserData: vi.fn(),
  dbGetUserData: vi.fn(),
  dbDeleteUserData: vi.fn(),
  dbAddAuditLog: mocks.dbAddAuditLog,
}));

import { GET, POST } from '@/app/api/admin/users/route';

describe('POST /api/admin/users password audit', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.requireAdminUser.mockResolvedValue({ id: 'root-admin', name: 'root', role: 'admin' });
    mocks.isRootAdminUser.mockReturnValue(true);
    mocks.updateManagedUser.mockResolvedValue({ id: 'user-1', name: 'user', role: 'user' });
    mocks.listManagedUsers.mockResolvedValue([]);
    mocks.repairDuplicateUserIds.mockResolvedValue({ repaired: 1, users: [] });
  });

  it('redacts passwords from update audit logs', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        userId: 'user-1',
        updates: { password: 'local-test-password' },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.dbAddAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.not.stringContaining('local-test-password'),
    }));
  });

  it('runs duplicate-ID repair only through the root-admin endpoint', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'repair-duplicate-ids' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.repairDuplicateUserIds).toHaveBeenCalledOnce();
  });

  it('allows a non-root administrator to load the user management data shown by the UI', async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', name: 'admin', role: 'admin' });
    mocks.isRootAdminUser.mockReturnValue(false);

    const response = await GET(new NextRequest('http://localhost/api/admin/users'));

    expect(response.status).toBe(200);
    expect(mocks.listManagedUsers).toHaveBeenCalledOnce();
  });
});
