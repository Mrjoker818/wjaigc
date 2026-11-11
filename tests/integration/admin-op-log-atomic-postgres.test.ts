import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { dbAddAuditLog, ensureCoreTables } from '@/lib/db-storage';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: async () => ({ id: 'test-admin', name: '测试管理员' }),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForFeature: vi.fn(() => { throw new Error('Provider access is forbidden in this test'); }),
}));

import { POST } from '@/app/api/admin/op-log/route';

function submit(body: { action: string; logId: string; status?: string; fixAction?: string }) {
  return POST(new NextRequest('http://localhost/api/admin/op-log', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

it('confirms the target exists and records a resolution with its audit entry in one transaction', async () => {
  await withIsolatedPostgres('op_log_receipt', async ({ query }) => {
    await ensureCoreTables();
    const logId = await dbAddAuditLog({
      user_id: 'synthetic-user', user_name: '合成用户', action: 'synthetic_operation',
      target_type: null, target_id: null, detail: null, ip_address: null, created_at: 1,
    });
    expect(logId).not.toBe('');
    const missing = await submit({ action: 'resolve', logId: 'absent', status: 'resolved' });
    const missingStatus = missing.status;

    await query("ALTER TABLE wujie_audit_log ADD CONSTRAINT test_reject_fix_audit CHECK (action <> 'op_log_fix')");
    const rejected = await submit({ action: 'fix', logId, fixAction: 'mark_resolved' });
    const afterRejected = await query('SELECT resolution_status FROM wujie_audit_log WHERE id = $1', [logId]);
    expect({ missingStatus, rejectedStatus: rejected.status, rows: afterRejected.rows }).toEqual({
      missingStatus: 404, rejectedStatus: 503, rows: [{ resolution_status: 'none' }],
    });

    await query('ALTER TABLE wujie_audit_log DROP CONSTRAINT test_reject_fix_audit');
    const advice = await submit({ action: 'fix', logId, fixAction: 'clear_rate_limit' });
    expect(advice.status).toBe(200);
    expect((await query('SELECT resolution_status FROM wujie_audit_log WHERE id = $1', [logId])).rows)
      .toEqual([{ resolution_status: 'none' }]);

    const fixed = await submit({ action: 'fix', logId, fixAction: 'mark_resolved' });
    expect(fixed.status).toBe(200);
    expect((await query('SELECT resolution_status FROM wujie_audit_log WHERE id = $1', [logId])).rows)
      .toEqual([{ resolution_status: 'resolved' }]);
    expect((await query("SELECT user_id FROM wujie_audit_log WHERE action = 'op_log_fix' AND target_id = $1", [logId])).rows)
      .toEqual([{ user_id: 'test-admin' }, { user_id: 'test-admin' }]);
  });
});
