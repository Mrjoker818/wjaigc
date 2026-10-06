import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(process.cwd(), 'src/lib/task-core/universal-generation-provider.ts'),
  'utf8',
);

describe('universal-generate transparent output contract', () => {
  it('normalizes aliases and forwards canonical transparent output fields', () => {
    expect(source).toContain('normalizeImageOutputRequestBody');
    expect(source).toContain('background: normalizedBody.background');
    expect(source).toContain('output_format: normalizedBody.output_format');
  });

  it('rejects unsupported transparent requests before contacting a provider', () => {
    expect(source).toContain('TRANSPARENT_BACKGROUND_UNSUPPORTED');
    expect(source.indexOf('normalizeImageOutputRequestBody')).toBeLessThan(
      source.indexOf('fetchWithV1Retry(baseUrl, endpoint'),
    );
  });

  it('verifies returned images instead of trusting a PNG filename', () => {
    expect(source).toContain('verifyGeneratedImageAlphaSet');
    expect(source).toContain('alphaVerification');
  });
});
