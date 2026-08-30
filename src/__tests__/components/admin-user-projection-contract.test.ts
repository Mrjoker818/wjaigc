import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('admin user projection UI contract', () => {
  it('accepts timestamp and legacy string last-login values', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/components/dashboard/admin-tabs.tsx'),
      'utf8',
    );

    expect(source).toMatch(/last_login\?:\s*string\s*\|\s*number/);
  });

  it('exposes authoritative projection fields on the shared user type', () => {
    const source = fs.readFileSync(path.join(root, 'src/lib/user-types.ts'), 'utf8');

    expect(source).toMatch(/credits\?:\s*number/);
    expect(source).toMatch(/project_count\?:\s*number/);
    expect(source).toMatch(/last_login\?:\s*string\s*\|\s*number/);
  });

  it('renders credits and project counts from the API projection', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/components/dashboard/admin-tabs.tsx'),
      'utf8',
    );

    expect(source).toContain('function getUserCredits(u: AdminUser): number { return u.credits ?? 0; }');
    expect(source).toContain('function getUserProjects(u: AdminUser): number { return u.project_count ?? 0; }');
  });
});
