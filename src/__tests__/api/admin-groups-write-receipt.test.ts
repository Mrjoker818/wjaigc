import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const storage = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), remove: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/server-auth', () => ({ requireAdminUser: async () => ({ id: 'admin', name: 'Admin', role: 'admin' }) }));
vi.mock('@/lib/db-storage', () => ({
  dbReadGroups: storage.read, dbWriteGroup: storage.write, dbDeleteGroup: storage.remove, dbAddAuditLog: storage.audit,
}));
import { POST } from '@/app/api/admin/groups/route';

const group = { id: 'g1', name: '原分组', product_types: ['canvas'], credit_quota: 10, is_active: true, created_at: 1, updated_at: 1 };
function request(action: 'create' | 'update' | 'delete'): NextRequest {
  return new NextRequest('https://groups.invalid/api/admin/groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'create' ? { action, name: '新分组' } : { action, id: 'g1', name: '修改分组' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.read.mockResolvedValue([group]); storage.write.mockResolvedValue(true);
  storage.remove.mockResolvedValue(true); storage.audit.mockResolvedValue('audit-1');
});

describe('group write receipts', () => {
  it.each(['create', 'update'] as const)('%s does not report success after an unconfirmed write', async action => {
    storage.write.mockResolvedValue(false);
    const response = await POST(request(action));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'unknown' });
    expect(storage.audit).not.toHaveBeenCalled();
  });
  it('does not report a confirmed deletion after an unconfirmed delete or membership update', async () => {
    storage.remove.mockResolvedValue(false);
    const response = await POST(request('delete'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'unknown' });
    expect(storage.audit).not.toHaveBeenCalled();
  });
  it.each(['create', 'update', 'delete'] as const)('%s does not report success when the audit write is unconfirmed', async action => {
    storage.audit.mockResolvedValue('');
    const response = await POST(request(action));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'unknown' });
  });
  it.each(['create', 'update', 'delete'] as const)('%s keeps the successful response when both operations return receipts', async action => {
    const response = await POST(request(action));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });
});
