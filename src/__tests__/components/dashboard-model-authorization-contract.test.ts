import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dashboard model authorization contract', () => {
  it('writes provider-bound model assignments while preserving the visible model label', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'),
      'utf8',
    );

    expect(source).toContain('id: `${providerId}::${model}`');
    expect(source).toContain('name: model');
  });
});
