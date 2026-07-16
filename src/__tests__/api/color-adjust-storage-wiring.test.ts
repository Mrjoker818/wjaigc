import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/image/color-adjust/route.ts'),
  'utf8'
);

describe('color adjust result storage', () => {
  it('writes adjusted images through the persistent serve-upload storage contract', () => {
    expect(source).toContain("saveImageFile(outputBuffer, filename, 'color-adjust')");
    expect(source).not.toContain("'public', 'api', 'serve-upload', 'color-adjust'");
  });

  it('can read a persisted serve-upload image for another adjustment', () => {
    expect(source).toContain("fetchImageBuffer(imageUrl)");
  });
});
