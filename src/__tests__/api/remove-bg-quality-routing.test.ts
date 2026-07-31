import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('remove-background quality routing', () => {
  it('evaluates the CPU result against the original source image', () => {
    expect(routeSource).toContain(
      'rembgResult.maskBase64,\n              sourceBuffer,',
    );
  });

  it('returns quality metrics for accepted CPU results', () => {
    expect(routeSource).toContain('quality: result.quality');
  });

  it('continues to the configured fallback when CPU quality validation rejects output', () => {
    expect(routeSource).toContain(
      "console.warn('[remove_background] rembg CPU output failed quality validation; trying configured fallback')",
    );
  });

  it('applies the same quality gate to the final local alpha fallback', () => {
    expect(routeSource).toContain(
      'const fallbackQuality = await evaluateRemoveBgOutput(sourceBuffer, localBuffer);',
    );
    expect(routeSource).toContain("code: 'REMOVE_BG_QUALITY_FAILED'");
    expect(routeSource).toContain('quality: fallbackQuality');
  });
});
