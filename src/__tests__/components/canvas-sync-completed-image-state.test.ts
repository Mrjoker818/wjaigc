import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('canvas project-sync state precedence', () => {
  it('keeps a locally completed image completed when the server still has its stale placeholder', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');

    expect(source).toContain('mergeLocalCompletedTaskProjection');
    expect(source).toContain('const enriched = mergeLocalCompletedTaskProjection({ ...img }, localImg);');
  });
});
