import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/admin-tabs.tsx'),
  'utf8',
);

describe('admin dashboard metrics UI contract', () => {
  it('renders unavailable success and failure rates without inventing percentages', () => {
    expect(source).toContain('successRate: number | null');
    expect(source).toContain("m.successRate === null ? '—' : `${m.successRate}%`");
    expect(source).toContain('failRate: number | null');
    expect(source).toContain("p.failRate === null ? '—' : `${p.failRate}%`");
  });
});
