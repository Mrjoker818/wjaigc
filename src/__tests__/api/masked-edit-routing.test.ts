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
