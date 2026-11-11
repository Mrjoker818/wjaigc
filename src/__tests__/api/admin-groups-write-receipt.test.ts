import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server-auth', () => ({ requireAdminUser: async () => ({ id: 'admin', name: 'Admin', role: 'admin' }) }));
vi.mock('@/lib/db-storage', () => ({ dbMutateGroup: mutate }));
import { POST } from '@/app/api/admin/groups/route';

const group = { id: 'g1', name: '原分组', product_types: ['canvas'], credit_quota: 10, is_active: true, created_at: 1, updated_at: 1 };
function request(action: 'create' | 'update' | 'delete'): NextRequest {
  return new NextRequest('https://groups.invalid/api/admin/groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'create' ? { action, name: '新分组' } : { action, id: 'g1', name: '修改分组' }),
  });
}

beforeEach(() => {
  mutate.mockReset();
});

describe('group write receipts', () => {
  it.each(['create', 'update', 'delete'] as const)('%s does not report success after an unconfirmed transaction', async action => {
    mutate.mockRejectedValueOnce(new Error('synthetic commit outcome unknown'));
    const response = await POST(request(action));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false, outcome: 'unknown', error: 'Group operation outcome unknown',
    });
  });
  it('keeps delete idempotent when the transaction confirms the group is already absent', async () => {
    mutate.mockResolvedValueOnce(null);
    const response = await POST(request('delete'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
  it.each(['create', 'update', 'delete'] as const)('%s reports success after the group transaction confirms the write', async action => {
    mutate.mockResolvedValueOnce(group);
    const response = await POST(request(action));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(action === 'delete' ? { success: true } : { success: true, group });
    expect(mutate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action }),
      expect.objectContaining({ id: 'admin', name: 'Admin' }),
    );
  });
});
