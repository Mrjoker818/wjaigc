import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'scripts/rembg_remove_background.py'), 'utf8');

describe('rembg CPU size guard', () => {
  it('limits inference input dimensions and restores the original output size', () => {
    expect(source).toContain('MAX_PROCESSING_EDGE = 2048');
    expect(source).toContain('processing_source = resize_for_processing(source)');
    expect(source).toContain("if result.size != original_size:");
  });

  it('defaults to the lite model and bounds onnxruntime threads', () => {
    expect(source).toContain("DEFAULT_MODEL = 'birefnet-general-lite'");
    expect(source).toContain('OMP_NUM_THREADS');
  });
});
