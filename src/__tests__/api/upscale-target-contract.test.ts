import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('image-edit upscale target contract', () => {
  it('validates exact target dimensions before invoking an upscale provider', () => {
    expect(routeSource).toContain("from '@/lib/upscale-target'");
    expect(routeSource).toContain(
      'validateUpscaleTargetDimensions(origW, origH, targetW, targetH)',
    );
    expect(routeSource).toContain('const targetW = targetWidth ?? origW * scaleVal');
    expect(routeSource).toContain('const targetH = targetHeight ?? origH * scaleVal');
    expect(routeSource).toContain('upscaleTargetError');
    expect(routeSource).toContain('{ status: 400 }');
  });

  it('accepts the target preset as request metadata', () => {
    expect(routeSource).toContain('targetPreset?: UpscaleTargetPreset');
  });
});
