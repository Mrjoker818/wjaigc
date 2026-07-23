import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const adminTabsSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/admin-tabs.tsx'),
  'utf8',
);
const dashboardSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);

describe('admin user batch delete contract', () => {
  it('submits one batch operation instead of opening one dialog per selected user', () => {
    expect(adminTabsSource).not.toContain(
      'selectedUserIds.forEach(id => props.onDeleteUser',
    );
    expect(adminTabsSource).toContain('await props.onBatchDeleteUsers(usersToDelete)');
    expect(dashboardSource).toContain("action: 'batch-delete'");
    expect(dashboardSource).toContain('userIds: users.map(user => user.id)');
  });
});
