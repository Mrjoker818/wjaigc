import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/image-compress.ts'), 'utf8');

describe('compressAndSave request contract', () => {
  it('sends the imageUrl field accepted by the save-image endpoint', () => {
    expect(source).toContain('JSON.stringify({ imageUrl: source })');
    expect(source).toContain('JSON.stringify({ imageUrl: result.dataUrl })');
    expect(source).not.toContain('JSON.stringify({ imageData:');
  });
});
