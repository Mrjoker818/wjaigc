import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('remove-background quality routing', () => {
  it('removes the CPU rembg evaluation path together with the local model', () => {
    expect(routeSource).not.toContain('rembgResult.maskBase64,\n              sourceBuffer,');
    expect(routeSource).not.toContain('quality: result.quality');
    expect(routeSource).not.toContain(
      "console.warn('[remove_background] rembg CPU output failed quality validation; trying configured fallback')",
    );
  });

  it('applies the same quality gate to the local alpha fallback', () => {
    expect(routeSource).toContain(
      'const fallbackQuality = await evaluateRemoveBgOutput(sourceBuffer, localBuffer);',
    );
    expect(routeSource).toContain("code: 'REMOVE_BG_QUALITY_FAILED'");
    expect(routeSource).toContain('quality: fallbackQuality');
  });
});
