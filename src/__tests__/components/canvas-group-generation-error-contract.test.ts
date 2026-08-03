import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('canvas reference and fusion group generation error contract', () => {
  it('requires an explicit provider route before submitting a group generation task', () => {
    expect(source).toContain('if (!providerId)');
    expect(source).toContain('当前参考图组未绑定提供商');
  });

  it('retains task-specific polling failures for the final group error state', () => {
    expect(source).toContain('const failedTasks = new Map<string, string>();');
    expect(source).toContain('getGroupGenerationFailureMessage(failedTasks.values())');
  });
});
