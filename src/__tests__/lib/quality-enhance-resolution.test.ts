import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const enhanceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/quality-enhance.ts'),
  'utf8',
);
const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('upscale quality enhancement resolution', () => {
  it('requests up to the provider 4K tier when the upscale target is 4K or 8K', () => {
    expect(enhanceSource).toContain('interface EnhanceTargetOptions');
    expect(enhanceSource).toContain('targetWidth?: number');
    expect(enhanceSource).toContain('targetHeight?: number');
    expect(enhanceSource).toContain("requestedMaxEdge >= 3072 ? '4K' : '2K'");
  });

  it('normalizes the post-enhancement image back to the exact upscale target', () => {
    expect(routeSource).toContain(
      'enhanceViaAI(resized.url, modelStr, effectiveProviderId, {',
    );
    expect(routeSource).toContain(
      'const normalizedFinal = await resizeAiResultToTarget(finalUrl);',
    );
    expect(routeSource).toContain('imageUrl: normalizedFinal.url');
    expect(routeSource).toContain(
      'outputSize: { width: normalizedFinal.actualW, height: normalizedFinal.actualH }',
    );
  });
});
