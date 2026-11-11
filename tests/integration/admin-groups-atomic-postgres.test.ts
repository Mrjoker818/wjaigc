import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { ensureCoreTables } from '@/lib/db-storage';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

vi.mock('@/lib/server-auth', () => ({
  requireAdminUser: async () => ({ id: 'test-admin', name: '测试管理员' }),
}));

import { POST } from '@/app/api/admin/groups/route';

function submit(body: { action: string; id?: string; name?: string; creditQuota?: number }) {
  return POST(new NextRequest('http://localhost/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

it('rolls back a group deletion and membership cleanup when the audit insert is rejected', async () => {
  await withIsolatedPostgres('group_delete_receipt', async ({ query }) => {
    await ensureCoreTables();
    const created = await submit({ action: 'create', name: '合成测试组' });
    expect(created.status).toBe(200);
    const { group } = await created.json() as { group: { id: string } };

    const updates = await Promise.all([
      submit({ action: 'update', id: group.id, name: '合成测试组更新' }),
      submit({ action: 'update', id: group.id, creditQuota: 18 }),
    ]);
    expect(updates.map(response => response.status)).toEqual([200, 200]);
    expect((await query('SELECT name, credit_quota FROM wujie_user_groups')).rows)
      .toEqual([{ name: '合成测试组更新', credit_quota: 18 }]);

    await query(
      'INSERT INTO wujie_users (id, name, password_hash, group_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)',
      ['test-member', '测试成员', 'unused', group.id, 1],
    );
    await query("ALTER TABLE wujie_audit_log ADD CONSTRAINT test_reject_group_delete CHECK (action <> 'group_delete')");

    const rejected = await submit({ action: 'delete', id: group.id });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ success: false, outcome: 'unknown' });
    expect((await query('SELECT id FROM wujie_user_groups')).rows).toEqual([{ id: group.id }]);
    expect((await query('SELECT group_id FROM wujie_users')).rows).toEqual([{ group_id: group.id }]);

    await query('ALTER TABLE wujie_audit_log DROP CONSTRAINT test_reject_group_delete');
    const deleted = await submit({ action: 'delete', id: group.id });
    expect(deleted.status).toBe(200);
    expect((await query('SELECT id FROM wujie_user_groups')).rows).toEqual([]);
    expect((await query('SELECT group_id FROM wujie_users')).rows).toEqual([{ group_id: null }]);
    expect((await query("SELECT user_id, target_id FROM wujie_audit_log WHERE action = 'group_delete'")).rows)
      .toEqual([{ user_id: 'test-admin', target_id: group.id }]);

    expect((await submit({ action: 'update', id: group.id, name: '已删除分组' })).status).toBe(404);
    expect((await query('SELECT id FROM wujie_user_groups')).rows).toEqual([]);

    await query("UPDATE wujie_users SET group_id = 'legacy-missing-group' WHERE id = 'test-member'");
    expect((await submit({ action: 'delete', id: 'legacy-missing-group' })).status).toBe(200);
    expect((await query('SELECT group_id FROM wujie_users')).rows).toEqual([{ group_id: null }]);
  });
});
