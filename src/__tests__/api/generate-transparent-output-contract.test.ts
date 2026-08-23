import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

describe('generate transparent output contract', () => {
  it('normalizes output fields after provider model resolution and before billing', () => {
    const normalization = source.indexOf('normalizeImageOutputRequestBody(');
    const billing = source.indexOf('consumeCredits(', normalization);

    expect(normalization).toBeGreaterThan(-1);
    expect(billing).toBeGreaterThan(normalization);
  });

  it('returns a stable unsupported capability code instead of silently falling back', () => {
    expect(source).toContain("code: 'TRANSPARENT_BACKGROUND_UNSUPPORTED'");
    expect(source).toContain('UnsupportedTransparentBackgroundError');
  });
});
