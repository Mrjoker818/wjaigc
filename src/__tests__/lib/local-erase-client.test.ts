import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ERASE_MODELS, VALID_ERASE_MODELS } from '@/lib/image-tools/local-erase-client';

const clientSource = readFileSync(
  resolve(process.cwd(), 'src/lib/image-tools/local-erase-client.ts'),
  'utf8',
);
const scriptSource = readFileSync(
  resolve(process.cwd(), 'scripts/iopaint_erase.py'),
  'utf8',
);

describe('local erase LaMa upgrade contract', () => {
  it('declares downloadable LaMa model files for health checks', () => {
    const lama = ERASE_MODELS.find(model => model.id === 'lama');
    expect(lama?.files).toContain('big-lama.pt');
  });

  it('keeps zits and anime-lama in the valid model set', () => {
    expect(VALID_ERASE_MODELS).toEqual(
      expect.arrayContaining(['lama', 'zits', 'anime-lama']),
    );
  });

  it('routes the selected model into the python script and reports the engine', () => {
    expect(clientSource).toContain('ERASE_SCRIPT');
    expect(clientSource).toContain('_eraseModel');
    expect(clientSource).toContain('withLocalInferenceLock');
    expect(clientSource).toContain('method=');
    expect(clientSource).toContain('stdout.match');
  });

  it('loads LaMa from the configured model directory', () => {
    expect(scriptSource).toContain('LAMA_MODEL_URL');
    expect(scriptSource).toContain('big-lama.pt');
  });

  it('sets a bounded torch thread pool for CPU inference', () => {
    expect(scriptSource).toContain('torch.set_num_threads');
    expect(scriptSource).toContain('IOPAINT_NUM_THREADS');
  });

  it('falls back to OpenCV Telea when LaMa is unavailable', () => {
    expect(scriptSource).toContain('opencv-telea');
    expect(scriptSource).toContain('INPAINT_TELEA');
  });
});
