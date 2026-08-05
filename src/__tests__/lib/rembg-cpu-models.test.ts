import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_REMBG_MODEL,
  REMBG_CPU_MODELS,
  isRembgCpuModel,
} from '@/lib/image-tools/rembg-client';

describe('CPU rembg model catalog', () => {
  it('uses the Windows Python launcher when no virtual environment is configured', () => {
    const configSource = readFileSync(resolve(process.cwd(), 'src/lib/image-tools/config.ts'), 'utf8');
    expect(configSource).toContain("process.platform === 'win32' ? 'python' : 'python3'");
  });

  it('defaults to the fast lite BiRefNet model', () => {
    expect(DEFAULT_REMBG_MODEL).toBe('birefnet-general-lite');
    expect(REMBG_CPU_MODELS.map(model => model.id)).toEqual([
      'birefnet-general-lite',
      'birefnet-general',
      'birefnet-portrait',
      'birefnet-massive',
    ]);
  });

  it('keeps lite and full BiRefNet choices and drops legacy IOPaint ids', () => {
    expect(isRembgCpuModel('birefnet-general-lite')).toBe(true);
    expect(isRembgCpuModel('birefnet-portrait')).toBe(true);
    expect(isRembgCpuModel('u2net')).toBe(false);
    expect(isRembgCpuModel('isnet-general-use')).toBe(false);
  });
});
