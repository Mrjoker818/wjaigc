import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/quick-create-panel.tsx'),
  'utf8',
);

describe('quick create fallback UI contract', () => {
  it('identifies a raw-request fallback without presenting it as a compiled professional plan', () => {
    expect(source).toContain("compileState.result?.mode === 'fallback'");
    expect(source).toContain('专业提示词编译暂不可用');
    expect(source).toContain('已按原始需求提交');
  });
});
