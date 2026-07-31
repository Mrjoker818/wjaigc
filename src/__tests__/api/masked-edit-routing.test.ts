import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const imageEditSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);
const pollTaskSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/poll-task/route.ts'),
  'utf8',
);

describe('masked edit production routing', () => {
  it('uses the lossless masked compositor for synchronous edit results', () => {
    expect(imageEditSource).toContain("import { compositeMaskedEdit } from '@/lib/image-tools/masked-edit-composite';");
    expect(imageEditSource.match(/compositeMaskedEdit\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(imageEditSource).not.toContain('AI erase result (no composite): JPEG');
    expect(imageEditSource).not.toContain('AI erase async result (no composite): JPEG');
    expect(imageEditSource).not.toContain('AI composite result: JPEG base64');
  });

  it('persists source and mask context for remote erase and mask tasks', () => {
    expect(imageEditSource.match(/originalImageUrl: imageUrl/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(imageEditSource.match(/maskImageUrl: maskImage/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('uses the same lossless compositor when asynchronous tasks complete', () => {
    expect(pollTaskSource).toContain("import { compositeMaskedEdit } from '@/lib/image-tools/masked-edit-composite';");
    expect(pollTaskSource).toContain('await compositeMaskedEdit({');
    expect(pollTaskSource).not.toContain('Crop paste-back: ${cropW}x${cropH} at (${cropX},${cropY}) → JPEG');
  });

  it('fails closed when masked composition cannot preserve the source exterior', () => {
    expect(imageEditSource).not.toContain('Composite failed, returning raw AI result as base64');
    expect(imageEditSource).not.toContain("engine: 'ai-raw'");
    expect(imageEditSource).toContain('MASKED_COMPOSITE_FAILED');
    expect(pollTaskSource).not.toContain('Masked edit composite failed, using raw AI result');
    expect(pollTaskSource).toContain('MASKED_COMPOSITE_FAILED');
  });
});
