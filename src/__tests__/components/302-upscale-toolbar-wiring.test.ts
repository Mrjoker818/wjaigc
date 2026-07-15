import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

describe('302.AI upscale toolbar wiring', () => {
  it('offers the two 302 models in AI upscale mode and forwards the selected id', () => {
    expect(source).toContain('THREE_O_TWO_UPSCALE_MODELS');
    expect(source).toContain('selected302UpscaleModel');
    expect(source).toContain('upscaleModel: upscaleMode === \'ai\' ? selected302UpscaleModel : undefined');
  });
});
