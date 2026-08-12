import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/lib/edit-task-store.ts'),
  'utf8',
);

describe('edit task memory terminal contract', () => {
  it('allows timeout as an exact terminal state', () => {
    expect(source).toContain("status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout'");
    expect(source).toContain("status: 'failed' | 'timeout' = 'failed'");
  });
});
