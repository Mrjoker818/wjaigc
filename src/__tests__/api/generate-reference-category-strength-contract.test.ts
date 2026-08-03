import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);

describe('generate reference category strength contract', () => {
  it('accepts per-image per-category strengths before falling back to the legacy image-wide strengths', () => {
    expect(source).toContain('referenceCategoryStrengths');
    expect(source).toContain('categoryStrengthsByImage');
    expect(source).toContain('perCategoryStrength');
  });
});
