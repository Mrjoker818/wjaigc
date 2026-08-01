import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/admin-tabs.tsx'),
  'utf8',
);

describe('admin user creation form contract', () => {
  it('resets controlled values and opts out of current-login credential autofill', () => {
    expect(source).toContain('const resetNewUserForm = useCallback((): void => {');
    expect(source).toContain("setNewUserName('');");
    expect(source).toContain("setNewUserPassword('');");
    expect(source).toContain("setNewUserEmail('');");
    expect(source).toContain("setNewUserGroupId('');");
    expect(source).toContain('const openUserAddDrawer = useCallback((): void => {');
    expect(source).toContain('const closeUserAddDrawer = useCallback((): void => {');
    expect(source).toContain('onClick={openUserAddDrawer}');
    expect(source).toContain('onClick={closeUserAddDrawer}');
    expect(source).toContain('autoComplete="new-username"');
    expect(source).toContain('autoComplete="new-password"');
  });
});
