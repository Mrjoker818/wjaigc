import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/dashboard/desktop-admin-tab.tsx'), 'utf8');

describe('desktop admin destructive actions', () => {
  it('uses the application confirmation dialog instead of browser confirm', () => {
    expect(source).not.toContain('window.confirm(');
    expect(source).toContain('AlertDialog');
  });
});
