import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
  'utf8',
);

describe('legacy dashboard user password contract', () => {
  it('does not seed user creation with a reusable default password', () => {
    expect(source).toContain("const [newUserPassword, setNewUserPassword] = useState('');");
    expect(source).toContain("setNewUserName(''); setNewUserPassword(''); setNewUserEmail('');");
    expect(source).not.toContain("setNewUserPassword('123456')");
  });
});
