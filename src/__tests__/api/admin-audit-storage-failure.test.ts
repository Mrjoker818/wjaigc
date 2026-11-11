import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const addAuditLog = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: async () => ({ id: 'test-admin', name: '测试管理员' }),
}));
vi.mock('@/lib/db-storage', () => ({ dbAddAuditLog: addAuditLog }));

import { POST } from '@/app/api/admin/audit/route';

function auditRequest() {
  return new NextRequest('http://localhost/api/admin/audit', {
    method: 'POST',
    body: JSON.stringify({ action: 'test_action', targetId: 'test-target' }),
  });
}

describe('audit insert receipts', () => {
  it('reports an unconfirmed insert as a storage failure', async () => {
    addAuditLog.mockResolvedValueOnce('');
    const response = await POST(auditRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Failed to confirm audit log write',
    });
  });

  it('returns the persisted audit id for the authenticated actor', async () => {
    addAuditLog.mockResolvedValueOnce('audit-1');
    const response = await POST(auditRequest());
    expect(await response.json()).toEqual({ success: true, id: 'audit-1' });
    expect(addAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({
      user_id: 'test-admin',
      action: 'test_action',
      target_id: 'test-target',
    }));
  });
});
