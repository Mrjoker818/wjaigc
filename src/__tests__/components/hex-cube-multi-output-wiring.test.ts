import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('hex cube multi-output wiring', () => {
  it('adds every image returned by the aggregate generation task', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

    expect(source).toContain('const resultUrls = Array.isArray(pollData.result?.imageUrls)');
    expect(source).toContain('onAddImages(resultUrls, undefined');
  });
});
